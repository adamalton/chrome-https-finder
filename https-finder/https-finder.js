// Keep a local copy of the user settings, which is sync'd with chrome.storage.sync.
// This allows us to reference the settings instantly when we need them without having
// to wait for the asynchronous chrome.storage.sync.get callback.
var settings = {
	// these are the defaults
	autoswitch: true,
	notifyOnAutoswitch: true,
	syncDomains: false
};

var secure_domains = []; // Will be populated from storage.sync
var excluded_domains = []; // Will be populated from storage.sync

var FOUND_DOMAINS_STORAGE_KEY = 'https_finder_found_domains';
var EXCLUDED_DOMAINS_STORAGE_KEY = 'https_finder_excluded_domains';
var ACTIVE_NOTIFICATIONS = {}; // stores the info about notifiations which are currently open

// Debugging tool for wiping stuff
var wipeKnownHTTPSDomainsList = function(){
	var items = {};
	items[FOUND_DOMAINS_STORAGE_KEY] = [];
	chrome.storage.local.set(
		items,
		function(items){
			console.log("Wiped local storage of known HTTPS domains list.");
		}
	);
};

// wipeKnownHTTPSDomainsList();


var domainsStorage = {
	// Object which handles storing of the lists of known HTTPS domains and the excluded domains.
	// This allows the extension to have a defacto way of adding/removing domains to/from the lists
	// without having to worry about whether the sync-ing is switched on or not.
	// It also allows us to have all the sync-ing stuff handled in once place.
	// Note that even if sync-ing is switched on, we never use chrome.storage.sync as the main
	// storage location because doing so would open us up to the possibility that if/when another
	// device set()s one of the lists, it might overwrite our local list.

	_knownSecureDomains: [], // Internal storage of secure domains. Shouldn't be accessed directly.
	_excludedDomains: [], // Internal storage of excluded domains. Shouldn't be accessed directly.
	// These flags tell us whether or not we've 'imported' the initial lists of domains from
	// chrome.storage, and therefore tell us whether we can start syncing our local lists back to
	// chrome.storage without overwriting what was there already.  This allows us to 'receive' calls
	// to addKnownSecureDomain and addExcludedDomain before we've loaded in existing data, and
	// allows us to block calls to removeKnownSecureDomain and removeExcludedDomain until we've
	// loaded in existing data.
	_loadedDomainsListsFromLocal: false,
	_loadedDomainsListsFromSync: false,

	_onReadyListeners: [],

	init: function(){
		console.log("domainsStorage.init");
		chrome.storage.onChanged.addListener(this.storageOnChangedListener);
		this.fetchDomainsListsFromStorage();
	},

	// **************************************** PUBLIC API ****************************************

	// If you want a listener for when one of the lists is changed then just use the standard
	// chrome.storage.onChanged.addListener.  Assuming you've set stuff up by using the below
	// addOnReadyListener, then all subsequent changes will trigger the chrome.storage event.

	addOnReadyListener: function(func){
		console.log("addOnReadyListener");
		// Add a function to be called when the domains storage lists are ready
		if(this.isReady()){
			func();
		}else{
			this._onReadyListeners.push(func);
		}
	},

	addKnownSecureDomain: function(domain){
		console.log("addKnownSecureDomain");
		if(this._knownSecureDomains.indexOf(domain) === -1){
			this._knownSecureDomains.push(domain);
			this.syncKnownSecureDomainsToStorage();
			return true;
		}
		return false;
	},

	addExcludedDomain: function(domain){
		console.log("addExcludedDomain");
		if(this._excludedDomains.indexOf(domain) === -1){
			this._excludedDomains.push(domain);
			this.syncExcludedDomainsToStorage();
			return true;
		}
		return false;
	},

	removeKnownSecureDomain: function(domain){
		console.log("removeKnownSecureDomain");
		if(!this.isReady()){
			throw new Error("Cannot remove secure domain. Data not loaded from chrome.storage yet.");
		}
		var index = this._knownSecureDomains.indexOf(domain);
		if(index > -1){
			this._knownSecureDomains.splice(index, 1);
			this.syncKnownSecureDomainsToStorage();
			return true;
		}
		return false;
	},

	removeExcludedDomain: function(domain){
		console.log("removeExcludedDomain");
		if(!this.isReady()){
			throw new Error("Cannot remove excluded domain. Data not loaded from chrome.storage yet.");
		}
		var index = this._excludedDomains.indexOf(domain);
		if(index > -1){
			this._excludedDomains.splice(index, 1);
			this.syncExcludedDomainsToStorage();
			return true;
		}
		return false;
	},

	getKnownSecureDomains: function(){
		return this._knownSecureDomains;
	},

	getExcludedDomains: function(){
		return this._excludedDomains;
	},

	isKnownSecureDomain: function(domain){
		return this._knownSecureDomains.indexOf(domain) !== -1;
	},

	isExcludedDomain: function(domain){
		// Is the given domain one of the domains which is excluded by the user?
		for(var i=0; i< this._excludedDomains.length; i++){
			var excluded = this._excludedDomains[i];
			if(!excluded){
				continue;
			}
			// First check for an exact match
			if(domain == excluded){
				return true;
			}else if(excluded.match(/^\./)){
				// If the excluded domain is a wildcard, i.e. starts with a dot:
				// Split both domains by their dots and match the parts in reverse order
				var excluded_parts = excluded.replace(/^\./, '').split(".").reverse();
				var domain_parts = domain.split(".").reverse();
				// We only need to match all of the excluded parts, but we do need to match ALL of the
				// excluded parts
				if(domain_parts.length < excluded_parts.length){
					continue;
				}
				domain_parts = domain_parts.slice(0, excluded_parts.length);
				// Now do `array1 == array2`, but in Javascript
				var match = true;
				for(var i=0; i < excluded_parts.length; i++){
					if(excluded_parts[i] !== domain_parts[i]){
						match = false;
						break;
					}
				}
				if(match){
					return true;
				}
			}
		}
		return false;
	},

	// ************************************** END PUBLIC API **************************************

	isReady: function(){
		return this._loadedDomainsListsFromLocal && this._loadedDomainsListsFromSync;
	},

	maybeTriggerOnReadyListeners: function(){
		if(this.isReady()){
			console.log("Triggering on-ready listeners");
			for(var i=0; i<this._onReadyListeners.length; i++){
				this._onReadyListeners[i]();
			}
		}
	},

	fetchDomainsListsFromStorage: function(){
		// Fetch the lists of domains from chrome.storage and COMBINE them into our local lists.
		// We deliberately combine them (rather than overwrite them) so that we can allow the local
		// lists to be appended to before this sync-ing happens.
		console.log("fetchDomainsListsFromStorage");

		function callback(namespace, items){
			console.log("fetchDomainsListsFromStorage callback");
			var secure_domains = items[FOUND_DOMAINS_STORAGE_KEY] || [];
			if(secure_domains.length){
				if(!itemsAreEqual(secure_domains, this._knownSecureDomains)){
					this._knownSecureDomains = arrayUnique(
						secure_domains.concat(this._knownSecureDomains)
					);
				}
			}
			var excluded_domains = items[EXCLUDED_DOMAINS_STORAGE_KEY] || [];
			if(excluded_domains.length){
				if(!itemsAreEqual(excluded_domains, this._excludedDomains)){
					this._excludedDomains = arrayUnique(
						excluded_domains.concat(this._excludedDomains)
					);
				}
			}
			if(namespace == "local"){
				this._loadedDomainsListsFromLocal = true;
			}else{
				this._loadedDomainsListsFromSync = true;
			}
			this.maybeTriggerOnReadyListeners();
		}

		chrome.storage.local.get(
			[FOUND_DOMAINS_STORAGE_KEY, EXCLUDED_DOMAINS_STORAGE_KEY],
			callback.bind(this, "local")
		);
		chrome.storage.sync.get(
			[FOUND_DOMAINS_STORAGE_KEY, EXCLUDED_DOMAINS_STORAGE_KEY],
			callback.bind(this, "sync")
		);
	},

	syncKnownSecureDomainsToStorage: function(){
		console.log("syncKnownSecureDomainsToStorage");
		if(!this.isReady()){
			console.log("Domains lists not yet loaded from chrome.storage. Deferring");
			setTimeout(this.syncKnownSecureDomainsToStorage, 500);
			return;
		}
		var items = {};
		items[FOUND_DOMAINS_STORAGE_KEY] = self._knownSecureDomains;
		chrome.storage.local.set(items);
		if(settings.syncDomains){
			chrome.storage.sync.set(items);
		}
	},

	syncExcludedDomainsToStorage: function(){
		console.log("syncExcludedDomainsToStorage");
		if(!this.isReady()){
			console.log("Domains lists not yet loaded from chrome.storage. Deferring");
			setTimeout(this.syncExcludedDomainsToStorage, 500);
			return;
		}
		var items = {};
		items[EXCLUDED_DOMAINS_STORAGE_KEY] = self._excludedDomains;
		chrome.storage.local.set(items);
		if(settings.syncDomains){
			chrome.storage.sync.set(items);
		}
	},

	storageOnChangedListener: function(changes, namespace){
		// Take the changes from the chrome.storage change and apply them to our local lists.
		// This relies on the assumption that chrome syncs each change as an individual change
		// event, because if additions and removals are sent in the same change event then we
		// aren't able to know what to apply to our local list(s).
		// Our local lists as the source of truth
		// Note that this function has a circular relationship with the sync<X>ToStorage functions,
		// so to prevent infinite circling we have a check here which breaks the cycle if the
		// values coming from chrome.storage are the same as the ones we have locally, so the cycle
		// only continues until everything is sync'd.
		console.log("storageOnChangedListener");

		var _this = domainsStorage; // Yey, Javascript

		if(namespace === "sync" && !settings.syncDomains){
			// Ignore changes when sync-ing is switched off.  The mostly likely thing that will
			// be sync'd is the wiping out of the lists from chrome's 'sync' storage (for privacy),
			// so we don't want to sync that into our local lists.
			return;
		}

		for(var key in changes){
			if(key === FOUND_DOMAINS_STORAGE_KEY){
				var old_list = changes[key].oldValue;
				var new_list = changes[key].newValue;
				if(new_list.length > old_list.length){
					// Item added to the list, so combine it into our list
					if(!itemsAreEqual(new_list, _this._knownSecureDomains)){
						_this._knownSecureDomains = arrayUnique(new_list.concat(_this._knownSecureDomains));
						_this.syncKnownSecureDomainsToStorage();
					}
				}else if(new_list.length < old_list.length){
					// Item removed from the list, so remove it from our local list too
					if(getAdditionalItems(old_list, new_list).length){
						// If there are items in the new list which are not in the old list, even
						// though the new list is shorted
						throw new Error("New list of known domains is shorter but has new items");
					}
					var to_remove = getAdditionalItems(new_list, old_list);
					for(var i=0; i<to_remove.length; i++){
						var item = to_remove[i];
						var index = _this._knownSecureDomains.indexOf(item);
						if(index !== -1){
							_this._knownSecureDomains.splice(index, 1);
						}
					}
					_this.syncKnownSecureDomainsToStorage();
				}else{
					// Lists are the same length.  We don't have a way to deal with this.
					console.log(
						"Received update to known domains list but don't don't if it was an " +
						"addition or removal"
					);
				}
			}else if(key === EXCLUDED_DOMAINS_STORAGE_KEY){
				var old_list = changes[key].oldValue;
				var new_list = changes[key].newValue;
				if(new_list.length > old_list.length){
					// Item added to the list, so combine it into our list
					if(!itemsAreEqual(new_list, _this._excludedDomains)){
						_this._excludedDomains = arrayUnique(new_list.concat(_this._excludedDomains));
						_this.syncExcludedDomainsToStorage();
					}
				}else if(new_list.length < old_list.length){
					// Item removed from the list, so remove it from our local list too
					console.log("excluded domain item removal");
					if(getAdditionalItems(old_list, new_list).length){
						// If there are items in the new list which are not in the old list, even
						// though the new list is shorted
						throw new Error("New list of known domains is shorter but has new items");
					}
					var to_remove = getAdditionalItems(new_list, old_list);
					for(var i=0; i<to_remove.length; i++){
						var item = to_remove[i];
						var index = _this._excludedDomains.indexOf(item);
						if(index !== -1){
							_this._excludedDomains.splice(index, 1);
						}
					}
					_this.syncExcludedDomainsToStorage();
				}else{
					// Lists are the same length.  We don't have a way to deal with this.
					console.log(
						"Received update to excluded domains list but don't don't if it was an " +
						"addition or removal"
					);
				}
			}
			else if(key === "syncDomains"){
				var value = changes[key].newValue;
				_this.handleSyncDomainsSettingChange(value);
			}
		}
	},

	handleSyncDomainsSettingChange: function(value){
		console.log("handleSyncDomainsSettingChange");
		// When this setting is changed (either by the user in the Options screen or because they've
		// changed it in the Options screen on another device and the setting itself is being synced
		// to here) we have to do one of two things:
		// 1. If the setting has been changed to 'false', wipe all domains lists from the sync storage
		// for prviacy.
		if(!value){
			var items = {};
			items[FOUND_DOMAINS_STORAGE_KEY] = [];
			items[EXCLUDED_DOMAINS_STORAGE_KEY] = [];
			// This has a sort of circular callback effect with our onChanged listener, but it will
			// short circuit because the list will be empty
			chrome.storage.sync.set(items);
		}else{
			// 2. If the setting has been changed to 'true', ensure that the current local lists are
			// sync'd to the remote 'sync' lists.
			// There's a chance this this on-change listener has fired before the one which updates
			// the settings object, so update the settings object anyway to make sure that the two
			// functions we call will do the right thing:
			settings.syncDomains = true;
			this.syncKnownSecureDomainsToStorage();
			this.syncExcludedDomainsToStorage();
		}
	}

};


chrome.storage.sync.get(
	settings, // defaults
	function(items){
		// Update our local copy of the settings dict
		console.log("Updating copy of settings from chrome.storage.sync");
		for(var key in items){
			settings[key] = items[key];
		}
		// Now that settings syncDomains is set to the right thing we can initialise the domains
		// storage
		domainsStorage.init();
	}
);


chrome.storage.onChanged.addListener(function(changes, namespace) {
	for(var key in changes) {
		if(key in settings){
			settings[key] = changes[key].newValue;
			console.log("Updated setting %s to %s", key, changes[key].newValue);
			continue;
		}
	}
});


var onBeforeNavigate = function(details){
	// Event handler of chrome.webNavigation.onBeforeNavigate.
	// If we know that the domain is secure and the 'autoswitch' setting is true, switch to the
	// secure version before navigating
	console.log("onBeforeNavigate called");
	var domain = getDomain(details.url);
	if(
		details.frameId === 0 &&
		domainsStorage.isKnownSecureDomain(domain) &&
		!domainsStorage.isExcludedDomain(domain) &&
		settings.autoswitch
	){
		console.log("onBeforeNavigate: this domain is known to be available on HTTPS.");
		chrome.tabs.update(details.tabId, {url: getSecureUrl(details.url)});
	}
};


var onNavigationCommitted = function(details){
	console.log("onNavigationCommitted called");
	if(details.frameId !== 0){
		// TODO: we could potentially allow frames to be switched to HTTPS too, but that would
		// probably require changing the way we change the page (or in this case frame) URL from
		// chrome.tabs.update to something else
		console.log("Not the top frame, skipping");
		return;
	}
	checkIfSecureVersionAvailable(details);
};



var checkIfSecureVersionAvailable = function(details){
	// Check if a secure version of details.url is available, & if so call secureVersionIsAvailable
	console.log("checkIfSecureVersionAvailable");
	if(domainsStorage.isExcludedDomain(getDomain(details.url))){
		console.log("Domain is excluded for URL: %s", details.url);
		return;
	}
	console.log("Checking for secure version of URL: %s", details.url);
	var secure_url = getSecureUrl(details.url);
	var reqListener = function() {
		console.log("Secure version response:");
		console.dir(this);
		if(this.status === 200 && this.responseURL === secure_url){
			console.log('secure response is on secure URL');
			secureVersionIsAvailable(details);
		}else{
			console.log("Secure version not available.");
		}
	};
	var reqError = function(err) {
		console.log('Fetch Error :-S', err);
	};

	var req = new XMLHttpRequest();
	req.onload = reqListener;
	req.onerror = reqError;
	req.open('get', secure_url, true);
	req.send();
};


// this should be usable in the near future
var checkIfSecureVersionAvailable__fetch = function(details){
	fetch(getSecureUrl(details.url))
		.then(
			function(response){
				if(response.status === 200){
					console.log("secure version returned 200 response");
					secureVersionIsAvailable(details);
				}
				console.log("secure version returned non-200 response");
			}
		)
		.catch(function(err) {
			console.log("fetching secure version returned error response");
		}
	);
};


var secureVersionIsAvailable = function(details){
	console.log("secure version is available");
	if(settings.autoswitch){
		switchToSecureVersion(details.url, details.tabId);
		if(settings.notifyOnAutoswitch){
			notifyOfSwitch(getSecureUrl(details.url), details.tabId);
		}
	}else{
		notifyOfSecureVersionAvailable(details.url, details.tabId);
	}
};

var switchToSecureVersion = function(url, tab_id){
	console.log("switchToSecureVersion called");
	chrome.tabs.update(
		tab_id, {url: getSecureUrl(url)}
	);
	// we only store the fact that a domain is available securely once the user has actually
	// switched (automatically or manually)
	domainsStorage.addKnownSecureDomain(getDomain(url));
};

var notifyOfSwitch = function(url, tab_id){
	// Notifiy the user that we have switched to the HTTPS version of the page
	chrome.notifications.create(
		"",
		{
			type: "basic",
			iconUrl: "images/icon48.png",
			title: "HTTPS Finder",
			message: "Switched to secure version of page at " + truncateURL(url, 50),
			isClickable: false,
			buttons: [{"title": "Switch back & exclude this domain"}]
		},
		function(notificationId){
			// This is called by Chrome when the notification has been created
			ACTIVE_NOTIFICATIONS[notificationId] = {
				type: "switch_done",
				url: url,
				tab_id: tab_id,
			};
		}
	);
};

var notifyOfSecureVersionAvailable = function(url, tab_id){
	chrome.notifications.create(
		"",
		{
			type: "basic",
			iconUrl: "images/icon48.png",
			title: "HTTPS Finder",
			message: "This page is available on HTTPS",
			contextMessage: url,
			isClickable: false,
			buttons: [
				{"title": "Switch to secure version"},
				{"title": "Never for this domain"}
			]
		},
		function(notificationId){
			// This is called by Chrome when the notification has been created
			ACTIVE_NOTIFICATIONS[notificationId] = {
				type: "switch_possible",
				url: url,
				tab_id: tab_id,
			};
		}
	);
};

var notificationButtonClicked = function(notificationId, buttonIndex){
	// This is written on the assumption that Chrome only fires the onButtonClicked event for
	// notifications which were created by THIS Chrome extension
	var details = ACTIVE_NOTIFICATIONS[notificationId];
	if(details.type === "switch_possible"){
		// On this type of notification there are 2 buttons: "switch (once)" and "Never switch"
		if(buttonIndex === 0){
			// Switch (once).  Note that the "only this once" bit is based on the user's settings,
			// not on whether or not we store this as a known HTTPS domain (we always store it).
			switchToSecureVersion(details.url, details.tab_id);
		}else{
			// Exclude this domain
			var domain = getDomain(details.url);
			domainsStorage.addExcludedDomain(domain);
		}

	}else if(details.type === "switch_done"){
		// The only button on this type of notification is the "switch back and exclude" button
		var domain = getDomain(details.url);
		domainsStorage.addExcludedDomain(domain);
		chrome.tabs.update(details.tab_id, {url: getInsecureUrl(details.url)});
	}
	chrome.notifications.clear(notificationId);
	delete ACTIVE_NOTIFICATIONS[notificationId];
};

var notificationClosed = function(notificationId, byUser){
	// Called by Chrome when a notification is closed, either by the user or automatically
	delete ACTIVE_NOTIFICATIONS[notificationId];
};

var getSecureUrl = function(url){
	return String(url).replace(/^http:/, 'https:');
};

var getInsecureUrl = function(url){
	return String(url).replace(/^https:/, 'http:');
}

var getDomain = function(url){
	var domain = url.split("//")[1];
	return domain.match(/.*?(?=\/|$)/)[0];
};

var truncateURL = function(url, max_length){
	// Given a URL, truncate it to the given length for nicey nice display purposes
	// We always want to include the entire domain, even if it's long, and then truncate the
	// path part if necessary.
	// Find the end of the domain, i.e. the first slash which is not part of the http:// bit
	var end_of_domain = url.match(/[^:\/]\//); // Also includes the preceding character, e.g. "m/"
	if(!end_of_domain.length){
		// No domain? No trailing slash? Empty URL? Aliens?
		return url;
	}
	var min_length = url.indexOf(end_of_domain[0]);
	var max_length = Math.max(min_length, max_length);
	if(url.length <= max_length){
		return url;
	}
	return url.substr(0, max_length) + "…";
};

function arrayUnique(array) {
	var a = array.concat();
	for(var i=0; i<a.length; ++i) {
		for(var j=i+1; j<a.length; ++j) {
			if(a[i] === a[j])
				a.splice(j--, 1);
		}
	}
	return a;
};

function itemsAreEqual(array1, array2){
	// Are the items of the given arrays equal?
	// Order is ignored. Arrays are assumed to not contain any duplicates.
	if(array1.length !== array2.length){
		return false;
	}
	for(var i; i<array1.length; i++){
		if(array2.indexOf(array1[i]) === -1){
			return false;
		}
	}
	return true;
}

function getAdditionalItems(array1, array2){
	// Return an array of all the items which are in array2 but not in array1.
	var difference = [];
	for(var i=0; i<array2.length; i++){
		var item = array2[i];
		if(array1.indexOf(item) === -1){
			difference.push(item);
		}
	}
	return difference;
}


chrome.webNavigation.onBeforeNavigate.addListener(
	onBeforeNavigate,
	{url: [{schemes: ['http']}]}
);

chrome.webNavigation.onCommitted.addListener(
	onNavigationCommitted,
	{url: [{schemes: ['http']}]}
);

chrome.notifications.onButtonClicked.addListener(notificationButtonClicked);
chrome.notifications.onClosed.addListener(notificationClosed);
