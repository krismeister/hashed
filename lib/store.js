var Schema = require('./schema').Schema;
var util = require('./util');


/**
 * An object backed store of string values.  Allows registering multiple state
 * providers.
 * @param {function(Object)} callback Called with an object of serialized
 *     values whenever a provider updates state.
 * @constructor
 */
var Store = exports.Store = function(callback) {
  this._values = {};
  this._providers = [];
  this._callback = callback;
  this._callbackTimer = null;
};

Store.prototype._scheduleCallback = function() {
  if (this._callbackTimer) {
    clearTimeout(this._callbackTimer);
  }
  this._callbackTimer = setTimeout(this._debouncedCallback.bind(this));
};

Store.prototype._debouncedCallback = function() {
  this._callbackTimer = null;
  this._callback(this._values);
};

Store.prototype.unregister = function(callback) {
  this._providers = this._providers.filter(function(provider) {
    return provider.callback !== callback;
  });
};

/**
 * Register a new state provider.
 * @param {Object} config Schema config.
 * @param {function(Object)} callback Called by the store on state changes.
 * @return {function(Object)} Called by the provider on state changes.
 */
Store.prototype.register = function(config, callback) {
  var provider = {
    schema: new Schema(config),
    state: {},
    callback: callback
  };

  // ensure there are no conflicts with existing providers
  for (var i = 0, ii = this._providers.length; i < ii; ++i) {
    var conflicts = provider.schema.conflicts(this._providers[i].schema);
    if (conflicts) {
      throw new Error('Provider already registered using the same name: ' +
          conflicts);
    }
  }

  this._providers.push(provider);
  setTimeout(function() {
    if (this._providers.indexOf(provider) > -1) {
      this._notifyProvider(provider);
    }
  }.bind(this), 0);

  return function update(state) {
    if (this._providers.indexOf(provider) === -1) {
      throw new Error('Unregistered provider attempting to update state');
    }
    var serialized = {};
    var schema = provider.schema;
    for (var key in state) {
      serialized[schema.getPrefixed(key)] =
          schema.serialize(key, state[key], state);
    }
    util.extend(provider.state, state);
    util.extend(this._values, serialized);
    this._scheduleCallback();
  }.bind(this);
};


/**
 * Notify provider of stored state values where they differ from provider
 * state values.
 * @param {Object} provider Provider to be notified.
 */
Store.prototype._notifyProvider = function(provider) {
  var state = {};
  var changed = false;
  provider.schema.forEachKey(function(key, prefixed) {
    var deserializedValue;
    if (prefixed in this._values) {
      try {
        deserializedValue =
            provider.schema.deserialize(key, this._values[prefixed]);
      } catch (err) {
        deserializedValue = provider.schema.getDefault(key);
      }
    } else {
      deserializedValue = provider.schema.getDefault(key);
    }
    if (key in provider.state) {
      // compare to current provider state
      var serializedValue = provider.schema.serialize(key, deserializedValue,
          provider.state);
      var providerValue = provider.schema.serialize(key, provider.state[key],
          provider.state);
      if (serializedValue !== providerValue) {
        state[key] = deserializedValue;
        provider.state[key] = deserializedValue;
        changed = true;
      }
    } else {
      state[key] = deserializedValue;
      provider.state[key] = deserializedValue;
      changed = true;
    }
  }, this);
  if (changed) {
    provider.callback(state);
  }
};


/**
 * Call the callback for each registered provider.
 * @param {function(this:Store, Object)} callback Callback.
 */
Store.prototype._forEachProvider = function(callback) {
  for (var i = 0, ii = this._providers.length; i < ii; ++i) {
    callback.call(this, this._providers[i]);
  }
};


/**
 * Update the store's values, notifying providers as necessary.
 * @param {Object} values New values.
 */
Store.prototype.update = function(values) {
  this._values = values;
  setTimeout(function() {
    this._forEachProvider(this._notifyProvider);
  }.bind(this), 0);
};
