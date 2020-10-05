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
    var entity = this._entityPool.get();
    this._entities.push(entity);
    entity._manager = this;
    return entity;
  }
  /**
   * Cleanly remove entities based on tag. Avoids loop issues.
   * @param {String} tag
   */
  removeEntitiesByTag(tag) {
    var entities = this._tags[tag];
    if (!entities)
      return;
    for (var x = entities.length - 1; x >= 0; x--) {
      var entity = entities[x];
      entity.remove();
    }
  }
  /**
   * Dump all entities out of the manager. Avoids loop issues.
   */
  removeAllEntities() {
    for (var x = this._entities.length - 1; x >= 0; x--) {
      this._entities[x].remove();
    }
  }
  /**
   * Drop an entity. Returns it to the pool and fires all events for removing
   * components as well.
   * @param {Entity} entity
   */
  removeEntity(entity) {
    var index = this._entities.indexOf(entity);
    if (!~index) {
      throw new Error('Tried to remove entity not in list');
    }
    this.entityRemoveAllComponents(entity);
    // Remove from entity list
    // entity.emit('removed')
    this._entities.splice(index, 1);
    // Remove entity from any tag groups and clear the on-entity ref
    entity._tags.length = 0;
    for (var tag in this._tags) {
      var entities = this._tags[tag];
      var n = entities.indexOf(entity);
      if (~n)
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
    var entities = this._tags[tag];
    if (!entities) {
      entities = this._tags[tag] = [];
    }
    // Don't add if already there
    if (~entities.indexOf(entity))
      return;
    // Add to our tag index AND the list on the entity
    entities.push(entity);
    entity._tags.push(tag);
  }
  /**
   * @param {Entity} entity
   * @param {String} tag
   */
  entityRemoveTag(entity, tag) {
    var entities = this._tags[tag];
    if (!entities)
      return;
    var index = entities.indexOf(entity);
    if (!~index)
      return;
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
    var cName = componentPropertyName(component, this._options.camelCase);
    args = args || [];
    entity[cName] = new component(entity, ...args);
    entity[cName].entity = entity;
    // Check each indexed group to see if we need to add this entity to the list
    for (let groupName in this._groups) {
      var group = this._groups[groupName];
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
    var Cs = entity._Components;
    for (var j = Cs.length - 1; j >= 0; j--) {
      var C = Cs[j];
      entity.removeComponent(C);
    }
  }
  /**
   * @param {Entity} entity
   * @param {Function} Component
   */
  entityRemoveComponent(entity, Component) {
    var index = entity._Components.indexOf(Component);
    if (!~index)
      return;
    entity.emit('component removed', Component);
    // Check each indexed group to see if we need to remove it
    for (var groupName in this._groups) {
      var group = this._groups[groupName];
      if (!~group.Components.indexOf(Component)) {
        continue;
      }
      if (!entity.hasAllComponents(group.Components)) {
        continue;
      }
      var loc = group.entities.indexOf(entity);
      if (~loc) {
        group.entities.splice(loc, 1);
      }
    }
    // Remove T listing on entity and property ref, then free the component.
    var propName = componentPropertyName(Component, this._options.camelCase);
    entity._Components.splice(index, 1);
    delete entity[propName];
  }
  /**
   * Get a list of entities that have a certain set of components.
   * @param {Array.<Function>} Components
   * @return {Array.<Entity>}
   */
  queryComponents(Components) {
    var group = this._groups[this._groupKey(Components)];
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
    var entities = this._tags[tag];
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
    var key = this._groupKey(Components);
    if (this._groups[key])
      return;
    var group = this._groups[key] = new Group(Components);
    for (var n = 0; n < this._entities.length; n++) {
      var entity = this._entities[n];
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
    var cachedKey = this._groupKeyMap.get(Components);
    if (cachedKey) {
      return cachedKey;
    }
    var names = [];
    for (var n = 0; n < Components.length; n++) {
      var T = Components[n];
      names.push(getName(T));
    }
    var key = names
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
  var name = getName(Component);
  if (!name) {
    throw new Error('Component property name is empty, try naming your component function');
  }
  if (!camelCase) {
    return name;
  }
  return name.charAt(0).toLowerCase() + name.slice(1);
}


