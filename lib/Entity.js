const EventEmitter = require('events').EventEmitter;

/**
 * Basic component-driven object with facade functions for interacting with the
 * injected EntityManager object.
 * @constructor
 */
class Entity extends EventEmitter {
  constructor() {
    super();
    /**
     * Unique identifier.
     */
    this.id = nextId++;
    /**
     * Ref to the manager for this facade, injected right after being
     * instantiated.
     * @private
     */
    this._manager = null;
    /**
     * List of all the types of components on this entity.
     * @type {Array.<Function>}
     * @private
     */
    this._Components = [];
    /**
     * All tags that this entity currently has.
     * @type {Array.<String>}
     * @private
     */
    this._tags = [];
    // All entities are event emitters.
    EventEmitter.call(this);
  }
  /**
   * Re-init for pooling purposes.
   * @private
   */
  __init() {
    this.id = nextId++;
    this._manager = null;
    this._Components.length = 0;
    this._tags.length = 0;
  }
  /**
   * @param {Function} TComponent
   * @return {Entity} This entity.
   */
  addComponent(TComponent) {
    var args = Array.prototype.slice.call(arguments).slice(1);
    this._manager.entityAddComponent(this, TComponent, args);
    return this;
  }
  /**
   * @param {Function} TComponent
   * @return {Entity} This entity.
   */
  removeComponent(TComponent) {
    this._manager.entityRemoveComponent(this, TComponent);
    return this;
  }
  /**
   * @param {Function} TComponent
   * @return {boolean} True if this entity has TComponent.
   */
  hasComponent(TComponent) {
    return !!~this._Components.indexOf(TComponent);
  }
  /**
   * Drop all components.
   */
  removeAllComponents() {
    return this._manager.entityRemoveAllComponents(this);
  }
  /**
   * @param {Array.<Function>} Components
   * @return {boolean} True if entity has all Components.
   */
  hasAllComponents(Components) {
    var b = true;
    for (var i = 0; i < Components.length; i++) {
      var C = Components[i];
      b &= !!~this._Components.indexOf(C);
    }
    return b;
  }
  /**
   * @param {String} tag
   * @return {boolean} True if entity has tag.
   */
  hasTag(tag) {
    return !!~this._tags.indexOf(tag);
  }
  /**
   * @param {String} tag
   * @return {Entity} This entity.
   */
  addTag(tag) {
    this._manager.entityAddTag(this, tag);
    return this;
  }
  /**
   * @param {String} tag
   * @return {Entity} This entity.
   */
  removeTag(tag) {
    this._manager.entityRemoveTag(this, tag);
    return this;
  }
  /**
   * Remove the entity.
   * @return {void}
   */
  remove() {
    return this._manager.removeEntity(this);
  }
}

var nextId = 0;

module.exports = Entity;