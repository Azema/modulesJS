'use strict';

/* globals $:false */

import Cache from './cache.mjs';

const api = {
  base: 'https://api.betaseries.com',
  versions: {current: '3.0', last: '3.0'},
  resources: [ // Les ressources disponibles dans l'API
      'badges', 'comments', 'episodes', 'friends', 'members', 'messages',
      'movies', 'news', 'oauth', 'pictures', 'planning', 'platforms',
      'polls', 'reports', 'search', 'seasons', 'shows', 'subtitles',
      'timeline'
  ],
  check: { // Les endpoints qui nécessite de vérifier la volidité du token
    episodes: ['display', 'list', 'search'],
    movies  : ['list', 'movie', 'search', 'similars'],
    search  : ['all', 'movies', 'shows'],
    shows   : ['display', 'episodes', 'list', 'search', 'similars']
  }
};

/**
 * @class Classe abstraite des différents médias
 */
class Media {
    static token = '';
    static userKey = '';
    static cache = null;
    static counter = 0;
    static debug = true;
    static serverBaseUrl = '';

    constructor(data, elt) {
        if (typeof data !== 'object') {
            throw new Error('data is not an object');
        }
        Object.assign(this, data);
        this._type = {singular: 'unknown', plural: 'unknown'};
        this.elt = elt;
    }
    get elt() {
        return this._elt;
    }
    set elt (elt) {
        if (elt && !elt.hasOwnProperty('jquery')) {
            elt = $(elt);
        }
        this._elt = elt;
        if (this._elt) {
            this._eltId = this._elt.attr('id');
        }
    }
    init(data) {
        if (data) {
            Object.assign(this, data);
        }
    }
    /**
     * Sauvegarde l'objet en cache
     * @return {Media} This
     */
    save() {
        if (Media.cache instanceof Cache) {
            Media.cache.set(this._type.plural, this.id, this);
        }
        return this;
    }
    /**
     * Décode le titre de la page
     * @return {Media} This
     */
    decodeTitle() {
        let $elt = this.elt.find('.blockInformations__title'),
            title = $elt.text();

        if (/&#/.test(title)) {
            $elt.text($('<textarea />').html(title).text());
        }
    }
    /**
     * Ajoute le nombre de votes à la note dans l'attribut title de la balise
     * contenant la représentation de la note de la ressource
     *
     * @param  {Boolean} change  Indique si on doit changer l'attribut title du DOMElement
     * @return {String}         Le titre modifié de la note
     */
    changeTitleNote(change = true) {
        const $elt = this.elt.find('.js-render-stars');
        if (this.objNote.mean <= 0 || this.objNote.total <= 0) {
            if (change) $elt.attr('title', 'Aucun vote');
            return;
        }

        const votes = 'vote' + (parseInt(this.objNote.total, 10) > 1 ? 's' : ''),
              // On met en forme le nombre de votes
              total = new Intl.NumberFormat('fr-FR', {style: 'decimal', useGrouping: true})
                        .format(this.objNote.total),
              // On limite le nombre de chiffre après la virgule
              note = parseFloat(this.objNote.mean).toFixed(1);
        let title = `${total} ${votes} : ${note} / 5`;
        // On ajoute la note du membre connecté, si il a voté
        if (this.objNote.user > 0) {
            title += `, votre note: ${this.objNote.user}`;
        }
        if (change) {
            $elt.attr('title', title);
        }
        return title;
    }
    /**
     * Ajoute le nombre de votes à la note de la ressource
     */
    addNumberVoters() {
        const _this = this;
        const votes = $('.stars.js-render-stars'); // ElementHTML ayant pour attribut le titre avec la note de la série

        if (debug) console.log('addNumberVoters');

        // if (debug) console.log('addNumberVoters super.callApi', data);
        const title = this.changeTitleNote(true);
        // On ajoute un observer sur l'attribut title de la note, en cas de changement lors d'un vote
        new MutationObserver((mutationsList) => {
            let mutation;
            const changeTitleMutation = () => {
                // On met à jour le nombre de votants, ainsi que la note du membre connecté
                const upTitle = _this.changeTitleNote(false);
                // On évite une boucle infinie
                if (upTitle !== title) {
                    votes.attr('title', upTitle);
                }
            };
            for (mutation of mutationsList) {
                // On vérifie si le titre a été modifié
                if (! /vote/.test(mutation.target.title)) {
                    changeTitleMutation();
                }
            }
        }).observe(votes.get(0), {
            attributes: true,
            childList: false,
            characterData: false,
            subtree: false,
            attributeFilter: ['title']
        });
    }

    /**
     * Fonction d'authentification sur l'API BetaSeries
     *
     * @return {Promise}
     */
    static authenticate() {
        if (this.debug) console.log('authenticate');
        $('body').append(`
            <div id="containerIframe">
              <iframe id="userscript"
                      name="userscript"
                      title="Connexion à BetaSeries"
                      width="50%"
                      height="400"
                      src="${this.serverBaseUrl}/index.html"
                      style="background:white;margin:auto;">
              </iframe>
            </div>'
        `);
        return new Promise((resolve, reject) => {
            window.addEventListener("message", receiveMessage, false);
            function receiveMessage(event) {
                const origin = new URL(this.serverBaseUrl).origin;
                // if (debug) console.log('receiveMessage', event);
                if (event.origin !== origin) {
                    console.error('receiveMessage {origin: %s}', event.origin, event);
                    reject('event.origin is not %s', origin);
                    return;
                }
                if (event.data.message == 'access_token') {
                    this.token = event.data.value;
                    $('#containerIframe').remove();
                    resolve(event.data.value);
                    window.removeEventListener("message", receiveMessage, false);
                } else {
                    console.error('Erreur de récuperation du token', event);
                    reject(event.data);
                    notification('Erreur de récupération du token', 'Pas de message');
                    window.removeEventListener("message", receiveMessage, false);
                }
            }
        });
    }

    /**
     * Fonction servant à appeler l'API de BetaSeries
     *
     * @param  {String}   type              Type de methode d'appel Ajax (GET, POST, PUT, DELETE)
     * @param  {String}   resource          La ressource de l'API (ex: shows, seasons, episodes...)
     * @param  {String}   method            La fonction à appliquer sur la ressource (ex: search, list...)
     * @param  {Object}   args              Un objet (clef, valeur) à transmettre dans la requête
     * @param  {bool}     [no_cache=false]  Indique si on doit utiliser le cache ou non (Par défaut: false)
     * @return {Promise}
     */
    static callApi(type, resource, method, args, no_cache = false) {
        if (api.resources.indexOf(resource) === -1) {
            throw new Error(`Ressource (${resource}) inconnue dans l\'API.`);
        }
        let check = false,
            // Les en-têtes pour l'API
            myHeaders = {
                'Accept'                : 'application/json',
                'X-BetaSeries-Version'  : api.versions.current,
                'X-BetaSeries-Token'    : this.token,
                'X-BetaSeries-Key'      : this.userKey
            },
            checkKeys = Object.keys(api.check);

        if (this.debug) {
            console.log('Media.callApi', {
                type: type,
                resource: resource,
                method: method,
                args: args,
                no_cache: no_cache
            });
        }

        // On retourne la ressource en cache si elle y est présente
        if (this.cache instanceof Cache && ! no_cache && type === 'GET' && args && 'id' in args &&
            this.cache.has(resource, args.id))
        {
            //if (debug) console.log('super.callApi retourne la ressource du cache (%s: %d)', resource, args.id);
            return new Promise((resolve) => {
                resolve(this.cache.get(resource, args.id, 'super.callApi'));
            });
        }

        // On check si on doit vérifier la validité du token
        // (https://www.betaseries.com/bugs/api/461)
        if (userIdentified() && checkKeys.indexOf(resource) !== -1 &&
            api.check[resource].indexOf(method) !== -1)
        {
            check = true;
        }

        return new Promise((resolve, reject) => {
            this.counter++; // Incrément du compteur de requêtes à l'API
            if (check) {
                let paramsFetch = {
                    method: 'GET',
                    headers: myHeaders,
                    mode: 'cors',
                    cache: 'no-cache'
                };
                if (this.debug) console.info('%ccall /members/is_active', 'color:blue');
                fetch(`${api.base}/members/is_active`, paramsFetch).then(resp => {
                    if ( ! resp.ok) {
                        // Appel de l'authentification pour obtenir un token valide
                        this.authenticate().then(token => {
                            // On met à jour le token pour le prochain appel à l'API
                            myHeaders['X-BetaSeries-Token'] = token;
                            fetchUri(resolve, reject);
                        }).catch(err => reject(err) );
                        return;
                    }
                    fetchUri(resolve, reject);
                }).catch(error => {
                    if (debug) console.log('Il y a eu un problème avec l\'opération fetch: ' + error.message);
                    console.error(error);
                    reject(error.message);
                });
            } else {
                fetchUri(resolve, reject);
            }
        });
        function fetchUri(resolve, reject) {
            let uri = `${api.base}/${resource}/${method}`,
                initFetch = { // objet qui contient les paramètres de la requête
                    method: type,
                    headers: myHeaders,
                    mode: 'cors',
                    cache: 'no-cache'
                },
                keys = Object.keys(args);
            // On crée l'URL de la requête de type GET avec les paramètres
            if (type === 'GET' && keys.length > 0) {
                let params = [];
                for (let key of keys) {
                    params.push(key + '=' + encodeURIComponent(args[key]));
                }
                uri += '?' + params.join('&');
            } else if (keys.length > 0) {
                initFetch.body = new URLSearchParams(args);
            }

            fetch(uri, initFetch).then(response => {
                if (this.debug) console.log('fetch (%s %s) response status: %d', type, uri, response.status);
                // On récupère les données et les transforme en objet
                response.json().then((data) => {
                    if (this.debug) console.log('fetch (%s %s) data', type, uri, data);
                    // On gère le retour d'erreurs de l'API
                    if (data.hasOwnProperty('errors') && data.errors.length > 0) {
                        const code = data.errors[0].code,
                              text = data.errors[0].text;
                        if (code === 2005 ||
                            (response.status === 400 && code === 0 &&
                                text === "L'utilisateur a déjà marqué cet épisode comme vu."))
                        {
                            reject('changeStatus');
                        } else if (code == 2001) {
                            // Appel de l'authentification pour obtenir un token valide
                            this.authenticate().then(() => {
                                this.callApi(type, resource, method, args, no_cache)
                                .then((data) => {
                                    resolve(data);
                                }, (err) => {
                                    reject(err);
                                });
                            }, (err) => {
                                reject(err);
                            });
                        } else {
                            reject(JSON.stringify(data.errors[0]));
                        }
                        return;
                    }
                    // On gère les erreurs réseau
                    if (!response.ok) {
                        console.error('Fetch erreur network', response);
                        reject(response);
                        return;
                    }
                    resolve(data);
                });
            }).catch(error => {
                if (this.debug) console.log('Il y a eu un problème avec l\'opération fetch: ' + error.message);
                console.error(error);
                reject(error.message);
            });
        }
    }
}
/**
 * @class Classe représentant les séries
 */
class Show extends Media {
    constructor(data) {
        super(data, $('.blockInformations'));
        this._type = {singular: 'show', plural: 'shows'};
        this.init();
        this.save();
    }
    /**
     * Initialize l'objet avec les données
     * @param  {Object} data Les données de la série
     * @return {void}
     */
    init(data) {
        // On sauvegarde les épisodes et les similars
        const _episodes = this.episodes;
        const _similars = this.similars;
        if (data) {
            Object.assign(this, data);
        }
        this.nbSeasons = this.seasons;
        this.seasons = this.seasons_details;
        this.nbEpisodes = this.episodes;
        this.episodes = [];
        if (_episodes) {
            this.episodes = _episodes;
        }
        this.nbSimilars = this.similars;
        this.similars = [];
        if (_similars && _similars.length === this.similars) {
            this.similars = _similars;
        }
    }
    get objNote() {
        return this.notes;
    }
    isEnded() {
        return (this.status.toLowerCase() === 'ended') ? true : false;
    }
    isArchived() {
        return this.user.archived;
    }
    /**
     * Add Show to account member
     * @return {Promise} Promise of show
     */
    addToAccount() {
        const _this = this;
        if (this.in_account) return new Promise(resolve => resolve(_this));

        return new Promise((resolve, reject) => {
            super.callApi('POST', 'shows', 'show', {id: _this.id})
            .then(data => {
                _this.init(data.show);
                _this.save();
                resolve(_this);
            }, err => {
                reject(err);
            });
        });
    }
    /**
     * Remove Show from account member
     * @return {Promise} Promise of show
     */
    removeFromAccount() {
        if (! this.in_account) return new Promise(resolve => resolve());

        const _this = this;
        return new Promise((resolve, reject) => {
            super.callApi('DELETE', 'shows', 'show', {id: this.id})
            .then(data => {
                Object.assign(_this, data.show);
                _this.save();
                resolve(this);
            }, err => {
                reject(err);
            });
        });
    }
    /**
     * Archive la série
     * @return {Promise} Promise of show
     */
    archive() {
        const _this = this;
        return new Promise((resolve, reject) => {
            super.callApi('POST', 'shows', 'archive', {id: this.id})
            .then(data => {
                _this.init(data.show);
                _this.save();
                resolve(_this);
            }, err => {
                reject(err);
            });
        });
    }
    /**
     * Désarchive la série
     * @return {Promise} Promise of show
     */
    unarchive() {
        const _this = this;
        return new Promise((resolve, reject) => {
            super.callApi('DELETE', 'shows', 'archive', {id: this.id})
            .then(data => {
                _this.init(data.show);
                _this.save();
                resolve(_this);
            }, err => {
                reject(err);
            });
        });
    }
    /**
     * Ajoute la série aux favoris
     * @return {Promise} Promise of show
     */
    favorite() {
        const _this = this;
        return new Promise((resolve, reject) => {
            super.callApi('POST', 'shows', 'favorite', {id: this.id})
            .then(data => {
                _this.init(data.show);
                _this.save();
                resolve(_this);
            }, err => {
                reject(err);
            });
        });
    }
    /**
     * Supprime la série des favoris
     * @return {Promise} Promise of show
     */
    unfavorite() {
        const _this = this;
        return new Promise((resolve, reject) => {
            super.callApi('DELETE', 'shows', 'favorite', {id: this.id})
            .then(data => {
                _this.init(data.show);
                _this.save();
                resolve(_this);
            }, err => {
                reject(err);
            });
        });
    }
    /**
     * Met à jour les données de la série
     * @param  {Boolean}  [force=false] Forcer la récupération des données sur l'API
     * @param  {Function} [cb=noop]     Fonction de callback
     * @return {Promise}                Promesse (Show)
     */
    update(force = false, cb = noop) {
        const _this = this;
        // if (Media.debug) console.log('Show update', this);
        return new Promise((resolve, reject) => {
            _this.fetch(force).then(data => {
                _this.init(data.show);
                _this.save();
                _this.updateRender(function() {
                    resolve(_this);
                    cb();
                });
            })
            .catch(err => {
                reject(err);
                cb();
            });
        });
    }
    /**
     * Met à jour le rendu de la barre de progression
     * et du prochain épisode
     * @param  {Function} cb Fonction de callback
     * @return {void}
     */
    updateRender(cb = noop) {
        this.updateProgressBar();
        this.updateNextEpisode();
        let note = this.objNote;
        if (Media.debug) {
            console.log('Next ID et status', {
                next: this.user.next.id,
                status: this.status,
                archived: this.user.archived,
                note_user: note.user
            });
        }
        // Si il n'y a plus d'épisodes à regarder
        if (this.user.remaining === 0) {
            let promise = new Promise(resolve => { return resolve(); });
            // On propose d'archiver si la série n'est plus en production
            if (this.in_account && this.isEnded() && !this.isArchived())
            {
                if (Media.debug) console.log('Série terminée, popup confirmation archivage');
                promise = new Promise(resolve => {
                    new PopupAlert({
                        title: 'Archivage de la série',
                        text: 'Voulez-vous archiver cette série terminée ?',
                        callback_yes: function() {
                            $('#reactjs-show-actions button.btn-archive').trigger('click');
                            resolve();
                        },
                        callback_no: function() {
                            resolve();
                            return true;
                        }
                    });
                });
            }
            // On propose de noter la série
            if (note.user === 0) {
                if (Media.debug) console.log('Proposition de voter pour la série');
                promise.then(() => {
                    new PopupAlert({
                        title: trans("popin.note.title.show"),
                        text: "Voulez-vous noter la série ?",
                        callback_yes: function() {
                            $('.blockInformations__metadatas .js-render-stars').trigger('click');
                            return true;
                        },
                        callback_no: function() {
                            return true;
                        }
                    });
                });
            }
            promise.then(() => { cb(); });
        } else {
            cb();
        }
    }
    /**
     * Met à jour la barre de progression de visionnage de la série
     * @return {void}
     */
    updateProgressBar() {
        if (Media.debug) console.log('updateProgressBar');
        let progBar = $('.progressBarShow');
        // On met à jour la barre de progression
        progBar.css('width', this.user.status.toFixed(1) + '%');
    }
    /**
     * Met à jour le bloc du prochain épisode à voir
     * @return {void}
     */
    updateNextEpisode(cb = noop) {
        if (Media.debug) console.log('updateNextEpisode');
        const nextEpisode = $('a.blockNextEpisode');

        if (nextEpisode.length > 0 && this.user.next && this.user.next.id !== null) {
            if (Media.debug) console.log('nextEpisode et show.user.next OK', this.user);
            // Modifier l'image
            const img = nextEpisode.find('img'),
                  remaining = nextEpisode.find('.remaining div'),
                  parent = img.parent('div'),
                  height = img.attr('height'),
                  width = img.attr('width'),
                  next = this.user.next,
                  src = `https://api.betaseries.com/pictures/episodes?key=${betaseries_api_user_key}&id=${next.id}&width=${width}&height=${height}`;
            img.remove();
            parent.append(`<img src="${src}" height="${height}" width="${width}" />`);
            // Modifier le titre
            nextEpisode.find('.titleEpisode').text(`${next.code.toUpperCase()} - ${next.title}`);
            // Modifier le lien
            nextEpisode.attr('href', nextEpisode.attr('href').replace(/s\d{2}e\d{2}/, next.code.toLowerCase()));
            // Modifier le nombre d'épisodes restants
            remaining.text(remaining.text().trim().replace(/^\d+/, this.user.remaining));
        }
        else if (nextEpisode.length <= 0 && this.user.next && this.user.next.id !== null) {
            if (Media.debug) console.log('No nextEpisode et show.user.next OK', this.user);
            buildNextEpisode(this);
        }
        else if (! this.user.next || this.user.next.id === null) {
            nextEpisode.remove();
        }
        fnLazy.init();
        cb();

        /**
             * Construit une vignette pour le prochain épisode à voir
             * @param  {Object} res  Objet API show
             * @return {void}
             */
        function buildNextEpisode(res) {
            let height = 70,
                width = 124,
                src = `https://api.betaseries.com/pictures/episodes?key=${betaseries_api_user_key}&id=${res.user.next.id}&width=${width}&height=${height}`,
                serieTitle = res.resource_url.split('/').pop(),
                template = `
                    <a href="/episode/${serieTitle}/${res.user.next.code.toLowerCase()}" class="blockNextEpisode media">
                      <div class="media-left">
                        <div class="u-insideBorderOpacity u-insideBorderOpacity--01">
                          <img src="${src}" width="${width}" height="${height}">
                        </div>
                      </div>
                      <div class="media-body">
                        <div class="title">
                          <strong>Prochain épisode à regarder</strong>
                        </div>
                        <div class="titleEpisode">
                          ${res.user.next.code.toUpperCase()} - ${res.user.next.title}
                        </div>
                        <div class="remaining">
                          <div class="u-colorWhiteOpacity05">${res.user.remaining} épisode${(res.user.remaining > 1) ? 's' : ''} à regarder</div>
                        </div>
                      </div>
                    </a>`;
            $('.blockInformations__actions').after(template);
        }
    }
    fetch(force = false) {
        return super.callApi('GET', 'shows', 'display', {id: this.id}, force);
    }
    /**
     * Retourne l'objet Similar correspondant à l'ID
     * @param  {Number} id  ID de l'épisode
     * @return {Similar}    L'objet Similar
     */
    getSimilar(id) {
        if (!this.similars) return null;
        for (let s = 0; s < this.similars.length; s++) {
            if (this.similars[s].id === id) {
                return this.similars[s];
            }
        }
        return null;
    }
    /**
     * Retourne l'objet Episode correspondant à l'ID
     * @param  {Number} id  ID de l'épisode
     * @return {Episode}    L'objet Episode
     */
    getEpisode(id) {
        if (!this.episodes) return null;
        for (let e = 0; e < this.episodes.length; e++) {
            if (this.episodes[e].id === id) {
                return this.episodes[e];
            }
        }
        return null;
    }
    /*
     * On gère l'ajout de la série dans le compte utilisateur
     *
     * @param {boolean} trigEpisode Flag indiquant si l'appel vient d'un episode vu ou du bouton
     */
    addShowClick(trigEpisode = false) {
        const _this = this;
        const vignettes = $('#episodes .slide__image');
        // Vérifier si le membre a ajouter la série à son compte
        if (! this.in_account) {
            // Remplacer le DOMElement supprime l'eventHandler
            $('#reactjs-show-actions').html(`
                <div class="blockInformations__action">
                  <button class="btn-reset btn-transparent" type="button">
                    <span class="svgContainer">
                      <svg fill="#0D151C" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
                        <path d="M14 8H8v6H6V8H0V6h6V0h2v6h6z" fill-rule="nonzero"></path>
                      </svg>
                    </span>
                  </button>
                  <div class="label">Ajouter</div>
                </div>`
            );
            // On ajoute un event click pour masquer les vignettes
            $('#reactjs-show-actions > div > button').off('click').one('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (Media.debug) console.groupCollapsed('AddShow');

                _this.addToAccount()
                .then(show => {
                    // On met à jour les boutons Archiver et Favori
                    changeBtnAdd(show);
                    // On met à jour le bloc du prochain épisode à voir
                    _this.updateNextEpisode(function() {
                        if (Media.debug) console.groupEnd('AddShow');
                    });
                }, err => {
                    console.error('Error in addShowClick', err);
                    //notification('Erreur d\'ajout de la série', err);
                    if (Media.debug) console.groupEnd('AddShow');
                });
            });
        }

        /**
         * Ajoute les items du menu Options, ainsi que les boutons Archiver et Favoris
         * et on ajoute un voile sur les images des épisodes non-vu
         *
         * @param  {Show} show L'objet de type Show
         * @return {void}
         */
        function changeBtnAdd(show) {
            let $optionsLinks = $('#dropdownOptions').siblings('.dropdown-menu').children('a.header-navigation-item');
            if ($optionsLinks.length <= 2) {
                let react_id = $('script[id^="/reactjs/"]').get(0).id.split('.')[1],
                    urlShow = show.resource_url.substring(location.origin.length),
                    title = show.title.replace(/"/g, '\\"').replace(/'/g, "\\'"),
                    templateOpts = `
                          <button type="button" class="btn-reset header-navigation-item" onclick="new PopupAlert({
                            showClose: true,
                            type: "popin-subtitles",
                            reactModuleId: "reactjs-subtitles",
                            params: {
                              mediaId: "${show.id}",
                              type: "show",
                              titlePopin: "${title}";
                            },
                            callback: function() {
                              loadRecommendationModule('subtitles');
                              //addScript("/reactjs/subtitles.${react_id}.js", "module-reactjs-subtitles");
                            },
                          });">Sous-titres</button>
                          <a class="header-navigation-item" href="javascript:;" onclick="reportItem(${show.id}, 'show');">Signaler un problème</a>
                          <a class="header-navigation-item" href="javascript:;" onclick="showUpdate('${title}', ${show.id}, '0')">Demander une mise à jour</a>
                          <a class="header-navigation-item" href="webcal://www.betaseries.com/cal/i${urlShow}">Planning iCal de la série</a>

                          <form class="autocomplete js-autocomplete-form header-navigation-item">
                            <button type="reset" class="btn-reset fontWeight700 js-autocomplete-show" style="color: inherit">Recommander la série</button>
                            <div class="autocomplete__toShow" hidden="">
                              <input placeholder="Nom d'un ami" type="text" class="autocomplete__input js-search-friends">
                              <div class="autocomplete__response js-display-response"></div>
                            </div>
                          </form>
                          <a class="header-navigation-item" href="javascript:;">Supprimer de mes séries</a>`;
                if ($optionsLinks.length === 1) {
                    templateOpts = `<a class="header-navigation-item" href="${urlShow}/actions">Vos actions sur la série</a>` + templateOpts;
                }
                $('#dropdownOptions').siblings('.dropdown-menu.header-navigation')
                    .append(templateOpts);
            }

            // On remplace le bouton Ajouter par les boutons Archiver et Favoris
            const divs = $('#reactjs-show-actions > div');
            if (divs.length === 1) {
                $('#reactjs-show-actions').remove();
                let container = $('.blockInformations__actions'),
                    method = 'prepend';
                // Si le bouton VOD est présent, on place les boutons après
                if ($('#dropdownWatchOn').length > 0) {
                    container = $('#dropdownWatchOn').parent();
                    method = 'after';
                }
                container[method](`
                        <div class="displayFlex alignItemsFlexStart"
                             id="reactjs-show-actions"
                             data-show-id="${show.id}"
                             data-user-hasarchived="${show.user.archived ? '1' : ''}"
                             data-show-inaccount="1"
                             data-user-id="${betaseries_user_id}"
                             data-show-favorised="${show.user.favorited ? '1' : ''}">
                          <div class="blockInformations__action">
                            <button class="btn-reset btn-transparent btn-archive" type="button">
                              <span class="svgContainer">
                                <svg fill="#0d151c" height="16" width="16" xmlns="http://www.w3.org/2000/svg">
                                  <path d="m16 8-1.41-1.41-5.59 5.58v-12.17h-2v12.17l-5.58-5.59-1.42 1.42 8 8z"></path>
                                </svg>
                              </span>
                            </button>
                            <div class="label">${trans('show.button.archive.label')}</div>
                          </div>
                          <div class="blockInformations__action">
                            <button class="btn-reset btn-transparent btn-favoris" type="button">
                              <span class="svgContainer">
                                <svg fill="#FFF" width="20" height="19" xmlns="http://www.w3.org/2000/svg">
                                  <path d="M14.5 0c-1.74 0-3.41.81-4.5 2.09C8.91.81 7.24 0 5.5 0 2.42 0 0 2.42 0 5.5c0 3.78 3.4 6.86 8.55 11.54L10 18.35l1.45-1.32C16.6 12.36 20 9.28 20 5.5 20 2.42 17.58 0 14.5 0zm-4.4 15.55l-.1.1-.1-.1C5.14 11.24 2 8.39 2 5.5 2 3.5 3.5 2 5.5 2c1.54 0 3.04.99 3.57 2.36h1.87C11.46 2.99 12.96 2 14.5 2c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"></path>
                                </svg>
                              </span>
                            </button>
                            <div class="label">${trans('show.button.favorite.label')}</div>
                          </div>
                        </div>`);
                show.elt = $('reactjs-show-actions');
                // On ofusque l'image des épisodes non-vu
                let vignette;
                for (let v = 0; v < vignettes.length; v++) {
                    vignette = $(vignettes.get(v));
                    if (vignette.find('.seen').length <= 0) {
                        vignette.find('img.js-lazy-image').attr('style', 'filter: blur(5px);');
                    }
                }
            }
            _this.addEventBtnsArchiveAndFavoris();
            _this.deleteShowClick();
        }
        if (trigEpisode) {
            this.update(true).then(show => {
                changeBtnAdd(show);
            });
        }
    }
    /**
     * Gère la suppression de la série du compte utilisateur
     */
    deleteShowClick() {
        const _this = this;
        let $optionsLinks = $('#dropdownOptions').siblings('.dropdown-menu').children('a.header-navigation-item');
        // Le menu Options est au complet
        if (this.in_account && $optionsLinks.length > 2) {
            this.addEventBtnsArchiveAndFavoris();
            // Gestion de la suppression de la série du compte utilisateur
            $optionsLinks.last().removeAttr('onclick').off('click').on('click', (e) =>
            {
                e.stopPropagation();
                e.preventDefault();
                // Supprimer la série du compte utilisateur
                new PopupAlert({
                    title: trans("popup.delete_show.title", { "%title%": _this.title }),
                    text: trans("popup.delete_show.text", { "%title%": _this.title }),
                    callback_yes: function() {
                        _this.removeFromAccount()
                        .then(show => {
                            const afterNotif = function() {
                                // On nettoie les propriétés servant à l'update de l'affichage
                                show.user.status = 0;
                                show.user.archived = false;
                                show.user.favorited = false;
                                show.user.remaining = 0;
                                show.user.last = "S00E00";
                                show.user.next.id = null;
                                show.save();

                                // On remet le bouton Ajouter
                                $('#reactjs-show-actions').html(`
                                    <div class="blockInformations__action">
                                      <button class="btn-reset btn-transparent btn-add" type="button">
                                        <span class="svgContainer">
                                          <svg fill="#0D151C" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M14 8H8v6H6V8H0V6h6V0h2v6h6z" fill-rule="nonzero"></path>
                                          </svg>
                                        </span>
                                      </button>
                                      <div class="label">${trans('show.button.add.label')}</div>
                                    </div>`
                                );
                                // On supprime les items du menu Options
                                $optionsLinks.first().siblings().each((i, e) => { $(e).remove(); });
                                // Nettoyage de l'affichage des épisodes
                                const checks = $('#episodes .slide_flex');
                                let promise,
                                    update = false; // Flag pour l'update de l'affichage
                                if (show.episodes && show.episodes.length > 0) {
                                    promise = new Promise(resolve => resolve(show));
                                } else {
                                    promise = show.fetchEpisodes();
                                }
                                promise.then(show => {
                                    for (let e = 0; e < show.episodes.length; e++) {
                                        if (show.episodes[e].elt === null) {
                                            show.episodes[e].elt = $(checks.get(e));
                                        }
                                        if (e === show.episodes.length - 1) update = true;
                                        if (debug) console.log('clean episode %d', e, update);
                                        show.episodes[e].updateRender('notSeen', update);
                                    }
                                    show.addShowClick();
                                });
                            };
                            new PopupAlert({
                                title: trans("popup.delete_show_success.title"),
                                text: trans("popup.delete_show_success.text", { "%title%": _this.title }),
                                yes: trans("popup.delete_show_success.yes"),
                                callback_yes: afterNotif
                            });
                        }, (err) => {
                            notification('Erreur de suppression de la série', err);
                        });
                    },
                    callback_no: function() {}
                });
            });
        }
    }
    /**
     * Ajoute un eventHandler sur les boutons Archiver et Favoris
     */
    addEventBtnsArchiveAndFavoris() {
        const _this = this;
        let btnArchive = $('#reactjs-show-actions button.btn-archive'),
            btnFavoris = $('#reactjs-show-actions button.btn-favoris');
        if (btnArchive.length === 0 || btnFavoris.length === 0) {
            $('#reactjs-show-actions button:first').addClass('btn-archive');
            btnArchive = $('#reactjs-show-actions button.btn-archive');
            $('#reactjs-show-actions button:last').addClass('btn-favoris');
            btnFavoris = $('#reactjs-show-actions button.btn-favoris');
        }
        // Event bouton Archiver
        btnArchive.off('click').click((e) => {
            e.stopPropagation();
            e.preventDefault();
            if (super.debug) console.groupCollapsed('show-archive');
            // Met à jour le bouton d'archivage de la série
            function updateBtnArchive(promise, transform, label, notif) {
                promise.then(() => {
                    const parent = $(e.currentTarget).parent();
                    $('span', e.currentTarget).css('transform', transform);
                    $('.label', parent).text(trans(label));
                    if (super.debug) console.groupEnd('show-archive');
                }, err => {
                    notification(notif, err);
                    if (super.debug) console.groupEnd('show-archive');
                });
            }
            if (! _this.user.archived) {
                updateBtnArchive(
                    _this.archive(), 'rotate(180deg)',
                    'show.button.unarchive.label', 'Erreur d\'archivage de la série'
                );
            } else {
                updateBtnArchive(
                    _this.unarchive(), 'rotate(0deg)',
                    'show.button.archive.label', 'Erreur désarchivage de la série'
                );
            }
        });
        // Event bouton Favoris
        btnFavoris.off('click').click((e) => {
            e.stopPropagation();
            e.preventDefault();
            if (super.debug) console.groupCollapsed('show-favoris');
            if (! _this.user.favorited) {
                _this.favorite()
                .then(() => {
                    $(e.currentTarget).children('span').replaceWith(`
                          <span class="svgContainer">
                            <svg width="21" height="19" xmlns="http://www.w3.org/2000/svg">
                              <path d="M15.156.91a5.887 5.887 0 0 0-4.406 2.026A5.887 5.887 0 0 0 6.344.909C3.328.91.958 3.256.958 6.242c0 3.666 3.33 6.653 8.372 11.19l1.42 1.271 1.42-1.28c5.042-4.528 8.372-7.515 8.372-11.18 0-2.987-2.37-5.334-5.386-5.334z"></path>
                            </svg>
                          </span>`);
                    if (super.debug) console.groupEnd('show-favoris');
                }, err => {
                    notification('Erreur de favoris de la série', err);
                    if (super.debug) console.groupEnd('show-favoris');
                });
            } else {
                _this.unfavorite()
                .then(() => {
                    $(e.currentTarget).children('span').replaceWith(`
                          <span class="svgContainer">
                            <svg fill="#FFF" width="20" height="19" xmlns="http://www.w3.org/2000/svg">
                              <path d="M14.5 0c-1.74 0-3.41.81-4.5 2.09C8.91.81 7.24 0 5.5 0 2.42 0 0 2.42 0 5.5c0 3.78 3.4 6.86 8.55 11.54L10 18.35l1.45-1.32C16.6 12.36 20 9.28 20 5.5 20 2.42 17.58 0 14.5 0zm-4.4 15.55l-.1.1-.1-.1C5.14 11.24 2 8.39 2 5.5 2 3.5 3.5 2 5.5 2c1.54 0 3.04.99 3.57 2.36h1.87C11.46 2.99 12.96 2 14.5 2c2 0 3.5 1.5 3.5 3.5 0 2.89-3.14 5.74-7.9 10.05z"></path>
                            </svg>
                          </span>`);
                    if (super.debug) console.groupEnd('show-favoris');
                }, err => {
                    notification('Erreur de favoris de la série', err);
                    if (super.debug) console.groupEnd('show-favoris');
                });
            }
        });
    }
    /**
     * Ajoute la classification dans les détails de la ressource
     */
    addRating() {
        if (super.debug) console.log('addRating');

        if (this.rating) {
            let rating = ratings.hasOwnProperty(this.rating) ? ratings[this.rating] : '';
            if (rating !== '') {
                // On ajoute la classification
                $('.blockInformations__details')
                .append(
                    `<li id="rating"><strong>Classification</strong>
                        <img src="${rating.img}" title="${rating.title}"/>
                    </li>`
                );
            }
        }
    }
}

/**
 * @class Classe représentant les films
 */
class Movie extends Media {
    constructor(data) {
        super(data, $('.blockInformations'));
        this._type = {singular: 'movie', plural: 'movies'};
        this.init();
        this.save();
    }
    /**
     * Initialize l'objet avec les données
     * @param  {Object} data Les données de la série
     * @return {void}
     */
    init(data) {
        // On sauvegarde les épisodes et les similars
        const _similars = this.similars;
        const _comments = this.comments;
        const _characters = this.characters;
        if (data) {
            Object.assign(this, data);
        }
        this.nbSimilars = this.similars;
        this.similars = [];
        if (_similars && this.similars === _similars.length) {
            this.similars = _similars;
        }
        this.nbComments = this.comments;
        this.comments = [];
        if (_comments && this.comments === _comments.length) {
            this.comments = _comments;
        }
        this.nbCharacters = this.characters;
        this.characters = [];
        if (_characters && this.characters === _characters.length) {
            this.characters = _characters;
        }
    }
    get elt() {
        return this._elt;
    }
    set elt (elt) {
        if (elt && !elt.hasOwnProperty('jquery')) {
            elt = $(elt);
        }
        this._elt = elt;
    }
    get description() {
        return this.synopsis;
    }
    get objNote() {
        return this.notes;
    }
    get in_account() {
        return this.user.in_account;
    }
    fetch() {
        return super.callApi('GET', 'movies', 'movie', {id: this.id});
    }
    getSimilar(id) {
        if (!this.similars) return null;
        for (let s = 0; s < this.similars.length; s++) {
            if (this.similars[s].id === id) {
                return this.similars[s];
            }
        }
        return null;
    }
    /**
     * Add Movie to account member
     * @return {Promise} Promise of movie
     */
    addToAccount(state) {
        const _this = this;
        if (this.in_account) return new Promise(resolve => resolve(_this));

        return new Promise((resolve, reject) => {
            super.callApi('POST', 'movies', 'movie', {id: _this.id, state: state})
            .then(data => {
                _this.init(data.movie);
                _this.save();
                resolve(_this);
            }, err => {
                reject(err);
            });
        });
    }
    /**
     * Remove movie from account member
     * @return {Promise} Promise of movie
     */
    removeFromAccount() {
        const _this = this;
        if (!this.in_account) return new Promise(resolve => resolve(_this));

        return new Promise((resolve, reject) => {
            super.callApi('DELETE', 'movies', 'movie', {id: _this.id})
            .then(data => {
                _this.init(data.movie);
                _this.save();
                resolve(_this);
            }, err => {
                reject(err);
            });
        });
    }
}

/**
 * @class Classe représentant les épisodes
 */
class Episode extends Media {
    constructor(data, elt) {
        elt = elt || $('.blockInformations');
        super(data, elt);
        this._type = {singular: 'episode', plural: 'episodes'};
        if (!(data.show instanceof Show)) {
            if (super.cache.has('shows', this.show.id)) {
                this.show = new Show(cache.get('shows', this.show.id));
            } else {
                // fetch show
            }
        }
        this.save();
    }
    init(data) {
        const _show = this.show;
        if (data) {
            Object.assign(this, data);
        }
        if (_show instanceof Show) {
            this.show = _show;
        }
    }
    get objNote() {
        return this.note;
    }
    addAttrTitle() {
        // Ajout de l'attribut title pour obtenir le nom complet de l'épisode, lorsqu'il est tronqué
        this.elt.find('.slide__title').attr('title', this.title);
    }
    initCheckSeen(pos) {
        const $checkbox = this.elt.find('.checkSeen');
        if ($checkbox.length > 0 && this.user.seen) {
            // On ajoute l'attribut ID et la classe 'seen' à la case 'checkSeen' de l'épisode déjà vu
            $checkbox.attr('id', 'episode-' + this.id);
            $checkbox.attr('data-id', this.id);
            $checkbox.attr('data-pos', pos);
            $checkbox.attr('data-special', this.special);
            $checkbox.attr('title', trans("member_shows.remove"));
            $checkbox.addClass('seen');
        } else if ($checkbox.length <= 0 && !this.user.seen && !this.user.hidden) {
            // On ajoute la case à cocher pour permettre d'indiquer l'épisode comme vu
            this.elt.find('.slide__image')
                .append(`<div id="episode-${this.id}"
                              class="checkSeen"
                              data-id="${this.id}"
                              data-pos="${pos}"
                              data-special="${this.special}"
                              style="background: rgba(13,21,28,.2);"
                              title="${trans("member_shows.markas")}"></div>`
            );
            this.elt.find('.slide__image img.js-lazy-image').attr('style', 'filter: blur(5px);');
        } else if ($checkbox.length > 0 && this.user.hidden) {
            $checkbox.remove();
        }
    }
    /**
     * Met à jour les infos de la vignette et appelle la fonction d'update du rendu
     * @param  {number} pos La position de l'épisode dans la liste
     * @return {boolean}    Indique si il y a eu un changement
     */
    updateCheckSeen(pos) {
        const $checkSeen = this.elt.find('.checkSeen');
        let changed = false;
        if ($checkSeen.length > 0 && $checkSeen.attr('id') === undefined) {
            if (debug) console.log('ajout de l\'attribut ID à l\'élément "checkSeen"');
            // On ajoute l'attribut ID
            $checkSeen.attr('id', 'episode-' + this.id);
            $checkSeen.data('pos', pos);
        }
        // if (debug) console.log('updateCheckSeen', {seen: this.user.seen, elt: this.elt, checkSeen: $checkSeen.length, classSeen: $checkSeen.hasClass('seen'), pos: pos, Episode: this});
        // Si le membre a vu l'épisode et qu'il n'est pas indiqué, on change le statut
        if (this.user.seen && $checkSeen.length > 0 && !$checkSeen.hasClass('seen')) {
            if (debug) console.log('Changement du statut (seen) de l\'épisode %s', this.code);
            this.updateRender('seen', false);
            changed = true;
        }
        // Si le membre n'a pas vu l'épisode et qu'il n'est pas indiqué, on change le statut
        else if (!this.user.seen && $checkSeen.length > 0 && $checkSeen.hasClass('seen')) {
            if (debug) console.log('Changement du statut (notSeen) de l\'épisode %s', this.code);
            this.updateRender('notSeen', false);
            changed = true;
        }
        else if (this.user.hidden && $checkSeen.length > 0) {
            $checkSeen.remove();
            changed = true;
        }
        return changed;
    }
    getTitlePopup() {
        return `<span style="color: var(--link_color);">Synopsis épisode ${this.code}</span>`;
    }
    /**
     * Modifie le statut d'un épisode sur l'API
     * @param  {String} status    Le nouveau statut de l'épisode
     * @param  {String} method    Verbe HTTP utilisé pour la requête à l'API
     * @return {void}
     */
    updateStatus(status, method) {
        const _this = this;
        const pos = this.elt.find('.checkSeen').data('pos');
        let promise = new Promise(resolve => { resolve(false); });
        let args = {id: this.id};

        if (method === 'POST') {
            let createPromise = () => {
                return new Promise(resolve => {
                    new PopupAlert({
                        title: 'Episodes vus',
                        text: 'Doit-on cocher les épisodes précédents comme vu ?',
                        callback_yes: () => {
                            resolve(true);
                        },
                        callback_no: () => {
                            resolve(false);
                        }
                    });
                });
            };
            const vignettes = $('#episodes .checkSeen');
            // On verifie si les épisodes précédents ont bien été indiqués comme vu
            for (let v = 0; v < pos; v++) {
                if (! $(vignettes.get(v)).hasClass('seen')) {
                    promise = createPromise();
                    break;
                }
            }
        }

        promise.then(response => {
            if (method === 'POST' && !response) {
                args.bulk = false; // Flag pour ne pas mettre les épisodes précédents comme vus automatiquement
            }

            super.callApi(method, 'episodes', 'watched', args).then(data =>
            {
                if (super.debug) console.log('updateStatus %s episodes/watched', method, data);
                if (! (_this.show instanceof Show) && cache.has('shows', _this.show.id)) {
                    _this.show = new Show(cache.get('shows', _this.show.id));
                }
                // Si un épisode est vu et que la série n'a pas été ajoutée
                // au compte du membre connecté
                if (! _this.show.in_account && data.episode.show.in_account) {
                    _this.show.in_account = true;
                    _this.show.save();
                    _this.show.addShowClick(true);
                }
                // On met à jour l'objet Episode
                if (method === 'POST' && response && pos) {
                    const $vignettes = $('#episodes .slide_flex');
                    for (let e = 0; e < pos; e++) {
                        if (_this.show.episodes[e].elt === null) {
                            _this.show.episodes[e].elt = $vignettes.get(e);
                        }
                        if (! _this.show.episodes[e].user.seen) {
                            _this.show.episodes[e].user.seen = true;
                            _this.show.episodes[e].updateRender('seen', false);
                            _this.show.episodes[e].save();
                        }
                    }
                }
                _this.init(data.episode);
                _this.updateRender(status, true);
                _this.save();
            })
            .catch(err => {
                if (debug) console.error('updateStatus error %s', err);
                if (err && err == 'changeStatus') {
                    if (debug) console.log('updateStatus error %s changeStatus', method);
                    _this.updateRender(status);
                } else {
                    _this.toggleSpinner(false);
                    notification('Erreur de modification d\'un épisode', 'updateStatus: ' + err);
                }
            });
        });
    }
    /**
     * Change le statut visuel de la vignette sur le site
     * @param  {String} newStatus     Le nouveau statut de l'épisode
     * @param  {bool}   [update=true] Mise à jour de la ressource en cache et des éléments d'affichage
     * @return {void}
     */
    updateRender(newStatus, update = true) {
        const _this = this;
        const $elt = this.elt.find('.checkSeen');
        const lenEpisodes = $('#episodes .checkSeen').length;
        const lenNotSpecial = $('#episodes .checkSeen[data-special="0"]').length;
        if (super.debug) console.log('changeStatus', {elt: $elt, status: newStatus, update: update});
        if (newStatus === 'seen') {
            $elt.css('background', ''); // On ajoute le check dans la case à cocher
            $elt.addClass('seen'); // On ajoute la classe 'seen'
            $elt.attr('title', trans("member_shows.remove"));
            // On supprime le voile masquant sur la vignette pour voir l'image de l'épisode
            $elt.parent('div.slide__image').find('img').removeAttr('style');
            $elt.parents('div.slide_flex').removeClass('slide--notSeen');

            const moveSeason = function() {
                const slideCurrent = $('#seasons div.slide--current');
                // On check la saison
                slideCurrent.find('.slide__image').prepend('<div class="checkSeen"></div>');
                slideCurrent
                    .removeClass('slide--notSeen')
                    .addClass('slide--seen');
                if (super.debug) console.log('Tous les épisodes de la saison ont été vus', slideCurrent);
                // Si il y a une saison suivante, on la sélectionne
                if (slideCurrent.next().length > 0) {
                    if (super.debug) console.log('Il y a une autre saison');
                    slideCurrent.next().trigger('click');
                    slideCurrent.removeClass('slide--current');
                }
            };
            const lenSeen = $('#episodes .seen').length;
            //if (debug) console.log('Episode.updateRender', {lenEpisodes: lenEpisodes, lenNotSpecial: lenNotSpecial, lenSeen: lenSeen});
            // Si tous les épisodes de la saison ont été vus
            if (lenSeen === lenEpisodes) {
                moveSeason();
            } else if (lenSeen === lenNotSpecial) {
                new PopupAlert({
                    title: 'Fin de la saison',
                    text: 'Tous les épisodes de la saison, or spéciaux, ont été vu.<br/>Voulez-vous passer à la saison suivante ?',
                    callback_yes: () => {
                        moveSeason();
                    },
                    callback_no: () => {
                        return true;
                    }
                });
            }
        } else {
            $elt.css('background', 'rgba(13,21,28,.2)'); // On enlève le check dans la case à cocher
            $elt.removeClass('seen'); // On supprime la classe 'seen'
            $elt.attr('title', trans("member_shows.markas"));
            // On remet le voile masquant sur la vignette de l'épisode
            $elt.parent('div.slide__image')
                .find('img')
                .attr('style', 'filter: blur(5px);');

            const contVignette = $elt.parents('div.slide_flex');
            if (!contVignette.hasClass('slide--notSeen')) {
                contVignette.addClass('slide--notSeen');
            }

            if ($('#episodes .seen').length < lenEpisodes) {
                $('#seasons div.slide--current .checkSeen').remove();
                $('#seasons div.slide--current').removeClass('slide--seen');
                $('#seasons div.slide--current').addClass('slide--notSeen');
            }
        }
        if (update) {
            if (this.show instanceof Show) {
                this.show.update(true).then(() => {
                    _this.toggleSpinner(false);
                });
            } else {
                console.warn('Episode.show is not an instance of class Show', this.show);
            }
        }
    }
    /**
     * Affiche/masque le spinner de modification des épisodes
     *
     * @param {Object} $elt     L'objet jQuery correspondant à l'épisode
     * @param {bool}   display  Le flag indiquant si afficher ou masquer
     * @return {void}
     */
    toggleSpinner(display) {
        if (! display) {
            $('.spinner').remove();
            fnLazy.init();
            if (super.debug) console.log('toggleSpinner');
            if (super.debug) console.groupEnd('episode checkSeen');
        } else {
            if (super.debug) console.groupCollapsed('episode checkSeen');
            if (super.debug) console.log('toggleSpinner');
            this.elt.find('.slide__image').prepend(`
                <div class="spinner">
                    <div class="spinner-item"></div>
                    <div class="spinner-item"></div>
                    <div class="spinner-item"></div>
                </div>`
            );
        }
    }
}

/**
 * @class Classe représentant les similaires de type séries et films
 */
class Similar extends Media {
    constructor(data, elt, type) {
        if (type.singular === 'show') {
            data._description = data.description;
            delete data.description;
            data._in_account = data.in_account;
            delete data.in_account;
        } else {
            data._in_account = data.user.in_account;
        }
        super(data, elt);
        this._type = type;
        this.save();
    }
    get in_account() {
        return this._in_account;
    }
    set in_account(val) {
        this._in_account = val;
    }
    addViewed() {
        // Si la série a été vue ou commencée
        if (this.user.status &&
            (
                (this._type.singular === 'movie' && this.user.status === 1) ||
                (this._type.singular === 'show' && this.user.status > 0))
            )
        {
            // On ajoute le bandeau "Viewed"
            this.elt.find('a.slide__image').prepend(
                `<img src="${serverBaseUrl}/img/viewed.png" class="bandViewed"/>`
            );
        }
    }
    wrench() {
        const $title = this.elt.find('.slide__title'),
              _this = this;
        $title.html($title.html() +
          `<i class="fa fa-wrench popover-wrench"
              aria-hidden="true"
              style="margin-left:5px;cursor:pointer;"
              data-id="${_this.id}"
              data-type="${_this._type.singular}">
           </i>`
        );

        $title.find('.popover-wrench').click((e) => {
            e.stopPropagation();
            e.preventDefault();
            const $dataRes = $('#dialog-resource .data-resource'), // DOMElement contenant le rendu JSON de la ressource
                  html = document.documentElement;
            const onShow = function() {
                html.style.overflowY = 'hidden';
                $('#dialog-resource')
                    .css('z-index', '1005')
                    .css('overflow', 'scroll');
            };
            const onHide = function() {
                html.style.overflowY = '';
                $('#dialog-resource')
                    .css('z-index', '0')
                    .css('overflow', 'none');
            };

            //if (debug) console.log('Popover Wrench', eltId, self);
            this.fetch().then(function(data) {
                $dataRes.empty().append(renderjson.set_show_to_level(2)(data[_this._type.singular]));
                $('#dialog-resource-title span.counter').empty().text('(' + counter + ' appels API)');
                $('#dialog-resource').show(400, onShow);
                $('#dialog-resource .close').click(e => {
                    e.stopPropagation();
                    e.preventDefault();
                    $('#dialog-resource').hide(400, onHide);
                });
            });
        });
    }
    fetch(force = false) {
        const method = this._type.singular === 'show' ? 'display' : 'movie';
        return super.callApi('GET', this._type.plural, method, {id: this.id}, force);
    }
    get description() {
        return (this._type.singular === 'show') ? this._description : this.synopsis;
    }
    set description(synopsis) {
        this.description = synopsis;
    }
    getContentPopup() {
        const _this = this,
              status = this.status == 'Ended' ? 'Terminée' : 'En cours',
              seen = (this.user.status > 0) ? 'Vu à <strong>' + this.user.status + '%</strong>' : 'Pas vu';
        //if (debug) console.log('similars tempContentPopup', objRes);
        let description = this.description;
        if (description.length > 200) {
            description = description.substring(0, 200) + '…';
        }
        let template = '';
        function _renderCreation() {
            let html = '';
            if (_this.creation || _this.country || _this.production_year) {
                html += '<p>';
                if (_this.creation) {
                    html += `<u>Création:</u> <strong>${_this.creation}</strong>`;
                }
                if (_this.production_year) {
                    html += `<u>Production:</u> <strong>${_this.production_year}</strong>`;
                }
                if (_this.country) {
                    html += `, <u>Pays:</u> <strong>${_this.country}</strong>`;
                }
                html += '</p>';
            }
            return html;
        }
        function _renderGenres() {
            if (_this.genres && _this.genres.length > 0) {
                return '<p><u>Genres:</u> ' + Object.values(_this.genres || []).join(', ') + '</p>';
            }
            return '';
        }
        template = '<div>';
        if (this._type.singular === 'show') {
            template += `<p><strong>${this.seasons}</strong> saison${(this.seasons > 1 ? 's':'')}, <strong>${this.episodes}</strong> épisodes, `;
            if (this.notes.total > 0) {
                template += `<strong>${this.notes.total}</strong> votes</p>`;
            } else {
                template += 'Aucun vote</p>';
            }
            if (! this.in_account) {
                template += '<p><a href="javascript:;" class="addShow">Ajouter</a></p>';
            }
            template += _renderGenres();
            template += _renderCreation();
            let archived = '';
            if (this.user.status > 0 && this.user.archived === true) {
                archived = ', Archivée: <i class="fa fa-check-circle-o" aria-hidden="true"></i>';
            } else if (this.user.status > 0) {
                archived = ', Archivée: <i class="fa fa-circle-o" aria-hidden="true"></i>';
            }
            if (this.showrunner && this.showrunner.length > 0) {
                template += `<p><u>Show Runner:</u> <strong>${this.showrunner.name}</strong></p>`;
            }
            template += `<p><u>Statut:</u> <strong>${status}</strong>, ${seen}${archived}</p>`;
        }
        // movie
        else {
            template += '<p>';
            if (this.notes.total > 0) {
                template += `<strong>${this.notes.total}</strong> votes`;
            } else {
                template += 'Aucun vote';
            }
            template += '</p>';
            // Ajouter une case à cocher pour l'état "Vu"
            template += `<p><label for="seen">Vu</label>
                <input type="checkbox" class="movie movieSeen" name="seen" data-movie="${this.id}" ${this.user.status === 1 ? 'checked' : ''} style="margin-right:5px;"></input>`;
            // Ajouter une case à cocher pour l'état "A voir"
            template += `<label for="mustSee">A voir</label>
                <input type="checkbox" class="movie movieMustSee" name="mustSee" data-movie="${this.id}" ${this.user.status === 0 ? 'checked' : ''} style="margin-right:5px;"></input>`;
            // Ajouter une case à cocher pour l'état "Ne pas voir"
            template += `<label for="notSee">Ne pas voir</label>
                <input type="checkbox" class="movie movieNotSee" name="notSee" data-movie="${this.id}"  ${this.user.status === 2 ? 'checked' : ''}></input></p>`;
            template += _renderGenres();
            template += _renderCreation();
            if (this.director) {
                template += `<p><u>Réalisateur:</u> <strong>${this.director}</strong></p>`;
            }
        }
        return template + `<p>${description}</p></div>`;
    }
    getTitlePopup() {
        if (debug) console.log('getTitlePopup', this);
        let title = this.title;
        if (this.notes.total > 0) {
            title += ' <span style="font-size: 0.8em;color:#000;">' +
                    parseFloat(this.notes.mean).toFixed(2) + ' / 5</span>';
        }
        return title;
    }
    updateTitleNote(change = true) {
        const $elt = this._elt.find('.stars-outer');
        if (this.notes.mean <= 0 || this.notes.total <= 0) {
            if (change) $elt.attr('title', 'Aucun vote');
            return;
        }

        const votes = 'vote' + (parseInt(this.notes.total, 10) > 1 ? 's' : ''),
              // On met en forme le nombre de votes
              total = new Intl.NumberFormat('fr-FR', {style: 'decimal', useGrouping: true})
                        .format(this.notes.total),
              // On limite le nombre de chiffre après la virgule
              note = parseFloat(this.notes.mean).toFixed(1);
        let title = `${total} ${votes} : ${note} / 5`;
        // On ajoute la note du membre connecté, si il a voté
        if (this.notes.user > 0) {
            title += `, votre note: ${this.notes.user}`;
        }
        if (change) {
            $elt.attr('title', title);
        }
        return title;
    }
    renderStars() {
        // On ajoute le code HTML pour le rendu de la note
        this._elt.find('.slide__title').after(
            '<div class="stars-outer"><div class="stars-inner"></div></div>'
        );
        this.updateTitleNote();
        let starPercentRounded = Math.round(((this.notes.mean / 5) * 100) / 10) * 10;
        this._elt.find('.stars-inner').width(starPercentRounded + '%');
    }
    decodeTitle() {
        let $elt = this._elt.find('.slide__title'),
            title = $elt.text();

        if (/&#/.test(title)) {
            $elt.text($('<textarea />').html(title).text());
        }
    }
    checkImg() {
        const $img = this._elt.find('img.js-lazy-image'),
              _this = this;
        if ($img.length <= 0) {
            if (this._type === 'show' && this.thetvdb_id && this.thetvdb_id > 0) {
                // On tente de remplacer le block div 404 par une image
                this._elt.find('div.block404').replaceWith(`
                    <img class="js-lazy-image u-opacityBackground fade-in"
                         width="125"
                         height="188"
                         alt="Poster de ${this.title}"
                         data-src="https://artworks.thetvdb.com/banners/posters/${this.thetvdb_id}-1.jpg"/>`
                );
                fnLazy.init();
            }
            else if (this._type === 'movie' && this.tmdb_id && this.tmdb_id > 0) {
                if (themoviedb_api_user_key.length <= 0) return;
                const uriApiTmdb = `https://api.themoviedb.org/3/movie/${this.tmdb_id}?api_key=${themoviedb_api_user_key}&language=fr-FR`;
                fetch(uriApiTmdb).then(response => {
                    if (!response.ok) return null;
                    return response.json();
                }).then(data => {
                    if (data !== null && data.hasOwnProperty('poster_path') && data.poster_path !== null) {
                        _this._elt.find('div.block404').replaceWith(`
                            <img class="js-lazy-image u-opacityBackground fade-in"
                                 width="125"
                                 height="188"
                                 alt="Poster de ${_this.title}"
                                 data-src="https://image.tmdb.org/t/p/original${data.poster_path}"/>`
                        );
                        fnLazy.init();
                    }
                });
            }
        }
    }
    /**
     * Add Show to account member
     * @return {Promise} Promise of show
     */
    addToAccount(state = 0) {
        const _this = this;
        if (this.in_account) return new Promise(resolve => resolve(_this));
        let params = {id: this.id};
        if (this._type.singular === 'movie') {
            params.state = state;
        }
        return new Promise((resolve, reject) => {
            super.callApi('POST', _this._type.plural, _this.type.singular, params)
            .then(data => {
                this.init(data[_this._type.singular]);
                _this.save();
                resolve(_this);
            }, err => {
                reject(err);
            });
        });
    }
}

/*
        Méthodes déplacées pour le bon chargement des classes
        les appels à d'autres classes dans une classe pose
        problème pour le chargement de celles-ci.
 */
/**
 * Méthode récupérant les épisodes de la série pour une saison
 * @param  {number}  season Le numéro de la saison
 * @param  {Boolean} force  Forcer l'appel à l'API
 * @return {Show}           L'objet Show
 */
Show.prototype.fetchEpisodes = function(season, force = false) {
    // if (debug) console.log('Show fetchEpisodes', {season: season, force: force, object: this});
    if (!season) {
        throw new Error('season required');
    }
    const _this = this;
    return new Promise((resolve, reject) => {
        super.callApi('GET', 'shows', 'episodes', {thetvdb_id: this.thetvdb_id, season: season}, true)
        .then(data => {
            _this.current_season = season;
            _this.episodes = [];
            for (let e = 0; e < data.episodes.length; e++) {
                data.episodes[e].show = _this;
                _this.episodes.push(new Episode(data.episodes[e], null));
            }
            _this.save();
            resolve(_this);
        }, err => {
            reject(err);
        });
    });
};
/**
 * Méthode récupérant les similaires de la série
 * @return {Show}  L'objet Show
 */
Show.prototype.fetchSimilars = function() {
    const _this = this;
    this.similars = [];
    return new Promise((resolve, reject) => {
        super.callApi('GET', 'shows', 'similars', {thetvdb_id: this.thetvdb_id, details: true}, true)
        .then(data => {
            if (data.similars.length > 0) {
                for (let s = 0; s < data.similars.length; s++) {
                    _this.similars.push(new Similar(data.similars[s].show, null, _this._type));
                }
            }
            _this.save();
            resolve(_this);
        }, err => {
            reject(err);
        });
    });
};
/**
 * Méthode récupérant les similaires du film
 * @return {Movie} L'objet Movie
 */
Movie.prototype.fetchSimilars = function() {
    const _this = this;
    this.similars = [];
    return new Promise((resolve, reject) => {
        super.callApi('GET', 'movies', 'similars', {id: this.id, details: true}, true)
        .then(data => {
            if (data.similars.length > 0) {
                for (let s = 0; s < data.similars.length; s++) {
                    _this.similars.push(new Similar(data.similars[s].movie, null, _this._type));
                }
            }
            resolve(_this);
        }, err => {
            reject(err);
        });
    });
};

export {Media, Show, Movie, Episode, Similar};