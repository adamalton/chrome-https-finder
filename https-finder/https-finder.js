// Keep a local copy of the user settings, which is sync'd with chrome.storage.sync.
// This allows us to reference the settings instantly when we need them without having
// to wait for the asynchronous chrome.storage.sync.get callback.
var settings = {
	// these are the defaults
	autoswitch: true,
	notifyOnAutoswitch: true
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


chrome.storage.sync.get(
	settings, // defaults
	function(items){
		console.log("Updating copy of settings from chrome.storage.sync");
		for(var key in items){
			settings[key] = items[key];
		}
	}
);

chrome.storage.local.get(
	EXCLUDED_DOMAINS_STORAGE_KEY,
	function(items){
		console.log("Updating excluded domains list from chrome.storage.sync");
		excluded_domains = items[EXCLUDED_DOMAINS_STORAGE_KEY] || [];
	}
);

chrome.storage.local.get(
	FOUND_DOMAINS_STORAGE_KEY,
	function(items){
		console.log("Updating known HTTPS domains list from chrome.storage.local");
		secure_domains = items[FOUND_DOMAINS_STORAGE_KEY] || [];
	}
);

chrome.storage.onChanged.addListener(function(changes, namespace) {
	for(var key in changes) {
		if(key in settings){
			settings[key] = changes[key].newValue;
			console.log("Updated setting %s to %s", key, changes[key].newValue);
		}else if(key === EXCLUDED_DOMAINS_STORAGE_KEY){
			excluded_domains = changes[key].newValue;
			console.log("Updated exluded domains list from storage change event.");
		}else if(key === FOUND_DOMAINS_STORAGE_KEY){
			secure_domains = changes[key].newValue;
			console.log("Updated known HTTPS domains list from storage change event.");
		}
	}
});

var syncExcludedDomainsBackToStorage = function(){
	// Take the local variable `excluded_domains` and sync it back to chrome.storage.
	// We've got the chrome.storage.onChanged listener, so we shouldn't need to pull the latest
	// version FROM storage first, just push TO it
	var items = {};
	items[EXCLUDED_DOMAINS_STORAGE_KEY] = excluded_domains;
	chrome.storage.local.set(items);
}

var onBeforeNavigate = function(details){
	// Event handler of chrome.webNavigation.onBeforeNavigate.
	// If we know that the domain is secure and the 'autoswitch' setting is true, switch to the
	// secure version before navigating
	console.log("onBeforeNavigate called");
	if(
		details.frameId === 0 &&
		isKnownSecureDomain(details.url) &&
		!domainIsExcluded(details.url) &&
		settings.autoswitch
	){
		console.log("onBeforeNavigate: this domain is known to be available on HTTPS.");
		chrome.tabs.update(details.tabId, {url: getSecureUrl(details.url)});
	}
};


var onNavigationCommitted = function(details){
	console.log("onNavigationCommitted called");
	console.log(String(document.location));
	console.dir(details.url);
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
	if(domainIsExcluded(details.url)){
		console.log("Domain is excluded for URL: %s", details.url);
		return;
	}
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


var domainIsExcluded = function(url){
	// Is the domain of the given URL excluded by the user's settings?
	var domain = url.replace(/^http:\/\//, '').split('/')[0];
	for(var i=0; i< excluded_domains.length; i++){
		var excluded = excluded_domains[i];
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
}

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
	rememberSecureDomain(url);
};

var rememberSecureDomain = function(url){
	// We deliberately use chrome.storage.local so that we're not storing a list of sites that the
	// user has visited on Google's servers.  This is a trade off of one privacy thing against
	// another - not using storage.sync means that the same user on a different computer may
	// re-visit a site on HTTP which they have previously found to be available on HTTPS, which is
	// bad, but I think not as bad as storing a list of domains that they've visisted on Google's
	// servers.
	console.log("rememberSecureDomain");
	var domain = getDomain(url);
	console.log(domain);
	var callback = function(items){
		console.log("rememberSecureDomain callback");
		var domains = items[FOUND_DOMAINS_STORAGE_KEY];
		if(!domains){
			domains = [];
			items[FOUND_DOMAINS_STORAGE_KEY] = domains;
		}
		if(domains.indexOf(domain) === -1){
			// We haven't yet stored this domain
			domains.push(domain);
			chrome.storage.local.set(items);
		}
	};
	chrome.storage.local.get(FOUND_DOMAINS_STORAGE_KEY, callback);
};

var isKnownSecureDomain = function(url){
	var domain = getDomain(url);
	return secure_domains.indexOf(domain) !== -1;
}

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
			excluded_domains.push(domain);
			syncExcludedDomainsBackToStorage();
		}

	}else if(details.type === "switch_done"){
		// The only button on this type of notification is the "switch back and exclude" button
		var domain = getDomain(details.url);
		excluded_domains.push(domain);
		syncExcludedDomainsBackToStorage();
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
