'use strict';

/**
 * @class Gestion du Cache pour le script
 */
class Cache {
    static debug = null;

    constructor() {
        this._data = {shows: {}, episodes: {}, movies: {}, members: {}};
    }

    /**
     * Returns an Array of all currently set keys.
     * @returns {Array} cache keys
     */
    keys(type = null) {
        if (! type) return Object.keys(this._data);
        return Object.keys(this._data[type]);
    }

    /**
     * Checks if a key is currently set in the cache.
     * @param {String} type Le type de ressource
     * @param {String} key  the key to look for
     * @returns {boolean} true if set, false otherwise
     */
    has(type, key) {
        return (this._data.hasOwnProperty(type) && this._data[type].hasOwnProperty(key));
    }

    /**
     * Clears all cache entries.
     * @param {String} [type=null] Le type de ressource à nettoyer
     */
    clear(type = null) {
        if (Cache.debug) console.log('Nettoyage du cache', type);
        // On nettoie juste un type de ressource
        if (type && this._data.hasOwnProperty(type)) {
            for (let key in this._data[type]) {
                delete this._data[type][key];
            }
        }
        // On nettoie l'ensemble du cache
        else {
            this._data = {shows: {}, episodes: {}, movies: {}, members: {}};
        }
    }

    /**
     * Gets the cache entry for the given key.
     * @param {String} type Le type de ressource
     * @param {String} key  the cache key
     * @returns {*} the cache entry if set, or undefined otherwise
     */
    get(type, key, caller=null) {
        if (this.has(type, key)) {
            if (caller !== null && Cache.debug) { console.log('[%s]: Retourne la ressource (%s) du cache', caller, type, {key: key}); }
            else if (Cache.debug) console.log('Retourne la ressource (%s) du cache', type, {key: key});
            return this._data[type][key];
        }
        return null;
    }

    /**
     * Returns the cache entry if set, or a default value otherwise.
     * @param {String} type Le type de ressource
     * @param {String} key  the key to retrieve
     * @param {*}      def  the default value to return if unset
     * @returns {*} the cache entry if set, or the default value provided.
     */
    getOrDefault(type, key, def) {
        if (Cache.debug) console.log('Retourne la ressource (%s) du cache ou valeur par défaut', type, {key: key, default: def});
        return this.has(type, key) ? this.get(type, key) : def;
    }

    /**
     * Sets a cache entry with the provided key and value.
     * @param {String} type  Le type de ressource
     * @param {String} key   the key to set
     * @param {*}      value the value to set
     */
    set(type, key, value) {
        // if (debug) console.log('Ajout de la ressource (%s) en cache', type, {key: key, val: value});
        if (this._data.hasOwnProperty(type)) {
            this._data[type][key] = value;
        }
    }

    /**
     * Removes the cache entry for the given key.
     * @param {String} type  Le type de ressource
     * @param {String} key the key to remove
     */
    remove(type, key) {
        if (Cache.debug) console.log('Suppression de la ressource (%s) du cache', type, {key: key});
        if (this.has(type, key)) {
            delete this._data[type][key];
        }
    }
}

export { Cache };