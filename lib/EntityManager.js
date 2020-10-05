module.exports = function (options) {
  return new EntityManager(options);
};

const Entity = require("./Entity.js");
const createPool = require("reuse-pool");
const getName = require("typedef").getName;

/**
 * Manage, create, and destroy entities. Can use methods to mutate entities
 * (tags, components) directly or via the facade on the Entity.
 * @constructor
 */
class EntityManager {
  constructor(options = {}) {
    /**
     * Map of tags to the list of their entities.
     * @private
     */
    this._tags = {};
    /**
     * @type {Array.<Entity>}
     * @private
     */
    this._entities = [];
    /**
     * @type {Array.<Group>}
     * @private
     */
    this._groups = {};
    /**
     * Pool entities.
     * @private
     */
    this._entityPool = createPool(function () { return new Entity(); });
    /**
     * Map of component names to their respective object pools.
     * @private
     */
    this._componentPools = {};
    /**
     * Map of component groups to group keys.
     * @private
     */
    this._groupKeyMap = new WeakMap();
    /**
     * Provide options for backwards compatible support
     * @type {{camelCase: boolean}}
     * @private
     */
    this._options = Object.assign({}, {
      camelCase: true
    }, options);
  }
  /**
   * Get a new entity.
   * @return {Entity}
   */
  createEntity() {
    const entity = this._entityPool.get();
    this._entities.push(entity);
    entity._manager = this;
    return entity;
  }
  /**
   * Cleanly remove entities based on tag. Avoids loop issues.
   * @param {String} tag
   */
  removeEntitiesByTag(tag) {
    const entities = this._tags[tag];
    if (!entities)
      return;
    for (let x = entities.length - 1; x >= 0; x--) {
      const entity = entities[x];
      entity.remove();
    }
  }
  /**
   * Dump all entities out of the manager. Avoids loop issues.
   */
  removeAllEntities() {
    for (let x = this._entities.length - 1; x >= 0; x--) {
      this._entities[x].remove();
    }
  }
  /**
   * Drop an entity. Returns it to the pool and fires all events for removing
   * components as well.
   * @param {Entity} entity
   */
  removeEntity(entity) {
    const index = this._entities.indexOf(entity);
    if (index === -1) {
      throw new Error('Tried to remove entity not in list');
    }
    this.entityRemoveAllComponents(entity);
    // Remove from entity list
    // entity.emit('removed')
    this._entities.splice(index, 1);
    // Remove entity from any tag groups and clear the on-entity ref
    entity._tags.length = 0;
    for (let tag in this._tags) {
      const entities = this._tags[tag];
      const n = entities.indexOf(entity);
      if (n > -1)
        entities.splice(n, 1);
    }
    // Prevent any acecss and free
    entity._manager = null;
    this._entityPool.recycle(entity);
    entity.removeAllListeners();
  }
  /**
   * @param {Entity} entity
   * @param {String} tag
   */
  entityAddTag(entity, tag) {
    let entities = this._tags[tag];
    if (!entities) {
      entities = this._tags[tag] = [];
    }
    // Don't add if already there
    if (entities.indexOf(entity) > -1) {
      return;
    }
    // Add to our tag index AND the list on the entity
    entities.push(entity);
    entity._tags.push(tag);
  }
  /**
   * @param {Entity} entity
   * @param {String} tag
   */
  entityRemoveTag(entity, tag) {
    const entities = this._tags[tag];
    if (!entities)
      return;
    const index = entities.indexOf(entity);
    if (index === -1) {
      return;
    }
    // Remove from our index AND the list on the entity
    entities.splice(index, 1);
    entity._tags.splice(entity._tags.indexOf(tag), 1);
  }
  
  /**
   * @param {Entity} entity
   * @param {Function} component
   */
  entityAddComponent(entity, component, args) {
    if (entity._Components.indexOf(component) > -1)
      return;
    entity._Components.push(component);
    // Create the reference on the entity to this component
    const cName = componentPropertyName(component, this._options.camelCase);
    args = args || [];
    entity[cName] = new component(entity, ...args);
    entity[cName].entity = entity;
    // Check each indexed group to see if we need to add this entity to the list
    for (let groupName in this._groups) {
      const group = this._groups[groupName];
      // Only add this entity to a group index if this component is in the group,
      // this entity has all the components of the group, and its not already in
      // the index.
      if (group.Components.indexOf(component) === -1) {
        continue;
      }
      if (!entity.hasAllComponents(group.Components)) {
        continue;
      }
      if (group.entities.indexOf(entity) > -1) {
        continue;
      }
      group.entities.push(entity);
    }
    entity.emit("component added", component);
  }
  /**
   * Drop all components on an entity. Avoids loop issues.
   * @param {Entity} entity
   */
  entityRemoveAllComponents(entity) {
    const components = entity._Components;
    for (let i = components.length - 1; i >= 0; i--) {
      const component = components[i];
      entity.removeComponent(component);
    }
  }
  /**
   * @param {Entity} entity
   * @param {Function} Component
   */
  entityRemoveComponent(entity, Component) {
    const index = entity._Components.indexOf(Component);
    if (index === -1)
      return;
    entity.emit('component removed', Component);
    // Check each indexed group to see if we need to remove it
    for (let groupName in this._groups) {
      const group = this._groups[groupName];
      if (group.Components.indexOf(Component) === -1) {
        continue;
      }
      if (!entity.hasAllComponents(group.Components)) {
        continue;
      }
      const loc = group.entities.indexOf(entity);
      if (loc > -1) {
        group.entities.splice(loc, 1);
      }
    }
    // Remove T listing on entity and property ref, then free the component.
    const propName = componentPropertyName(Component, this._options.camelCase);
    entity._Components.splice(index, 1);
    delete entity[propName];
  }
  /**
   * Get a list of entities that have a certain set of components.
   * @param {Array.<Function>} Components
   * @return {Array.<Entity>}
   */
  queryComponents(Components) {
    let group = this._groups[this._groupKey(Components)];
    if (!group) {
      group = this._indexGroup(Components);
    }
    return group.entities;
  }
  /**
   * Get a list of entities that all have a certain tag.
   * @param {String} tag
   * @return {Array.<Entity>}
   */
  queryTag(tag) {
    let entities = this._tags[tag];
    if (entities === undefined) {
      entities = this._tags[tag] = [];
    }
    return entities;
  }
  /**
   * @return {Number} Total number of entities.
   */
  count() {
    return this._entities.length;
  }
  /**
   * Create an index of entities with a set of components.
   * @param {Array.<Function>} Components
   * @private
   */
  _indexGroup(Components) {
    const key = this._groupKey(Components);
    if (this._groups[key])
      return;
    const group = this._groups[key] = new Group(Components);
    for (let n = 0; n < this._entities.length; n++) {
      const entity = this._entities[n];
      if (entity.hasAllComponents(Components)) {
        group.entities.push(entity);
      }
    }
    return group;
  }
  /**
   * @param {Array.<Function>} Components
   * @return {String}
   * @private
   */
  _groupKey(Components) {
    const cachedKey = this._groupKeyMap.get(Components);
    if (cachedKey) {
      return cachedKey;
    }
    const names = [];
    for (let n = 0; n < Components.length; n++) {
      const T = Components[n];
      names.push(getName(T));
    }
    const key = names
      .map(function (x) { return x.toLowerCase(); })
      .sort()
      .join('-');
    this._groupKeyMap.set(Components, key);
    return key;
  }
}

/**
 * Used for indexing our component groups.
 * @constructor
 * @param {Array.<Function>} Components
 * @param {Array<Entity>} entities
 */
function Group (Components, entities) {
  this.Components = Components || [];
  this.entities = entities || [];
}

/**
 * @param {Function} Component
 * @param {Boolean} camelCase whether to change casing of the name
 * @return {String}
 * @private
 */
function componentPropertyName (Component, camelCase = true) {
  const name = getName(Component);
  if (!name) {
    throw new Error('Component property name is empty, try naming your component function');
  }
  if (!camelCase) {
    return name;
  }
  return name.charAt(0).toLowerCase() + name.slice(1);
}


