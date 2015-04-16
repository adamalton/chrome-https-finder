// Keep a local copy of the user settings, which is sync'd with chrome.storage.sync.
// This allows us to reference the settings instantly when we need them without having
// to wait for the asynchronous chrome.storage.sync.get callback.
var settings = {
	// these are the defaults
	autoswitch: true,
	notifyOnAutoswitch: true
};

var FOUND_DOMAINS_STORAGE_KEY = 'https_finder_found_domains';

chrome.storage.sync.get(
	settings, // defaults
	function(items){
		console.log("Updating copy of settings from chrome.storage.sync");
		for(var key in items){
			settings[key] = items[key];
		}
	}
);

chrome.storage.onChanged.addListener(function(changes, namespace) {
	for(var key in changes) {
		if(key in settings){
			settings[key] = changes[key].newValue;
		}
		console.log("updated setting %s to %s", key, changes[key].newValue);
	}
});




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
		switchToSecureVersion(details.url);
		if(settings.notifyOnAutoswitch){
			notify(getSecureUrl(details.url));
		}
	}else{
		chrome.pageAction.show(details.tabId);
	}
};

var switchToSecureVersion = function(url){
	console.log("switchToSecureVersion called");
	chrome.tabs.update({
		url: getSecureUrl(url)
	});
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

var onPageActionClicked = function(tab){
	// fired when the user clicks the pageAction icon to switch to HTTPS
	console.log("onPageActionClicked called");
	console.dir(tab);
	switchToSecureVersion(tab.url);

};

var notify = function(url){
	chrome.notifications.create(
		"",
		{
			type: "basic",
			iconUrl: "images/icon48.png",
			title: "HTTPs Finder",
			message: "Switched to secure version of page at " + url,
			isClickable: false
		},
		function(){}
	);
};

var getSecureUrl = function(url){
	return String(url).replace(/^http:/, 'https:');
};

var getDomain = function(url){
	var domain = url.split("//")[1];
	return domain.match(/.*?(?=\/|$)/)[0];
};

chrome.webNavigation.onCommitted.addListener(
	onNavigationCommitted,
	{url: [{urlPrefix : 'http://'}]}
);

chrome.pageAction.onClicked.addListener(onPageActionClicked);



/*
// When the extension is installed or upgraded ...
chrome.runtime.onInstalled.addListener(function() {
  // Replace all rules ...
  chrome.declarativeContent.onPageChanged.removeRules(undefined, function() {
	// With a new rule ...
	chrome.declarativeContent.onPageChanged.addRules([
	  {
		// That fires when a page's URL contains a 'g' ...
		conditions: [
		  new chrome.declarativeContent.PageStateMatcher({
			pageUrl: { urlContains: 'g' },
		  })
		],
		// And shows the extension's page action.
		actions: [ new chrome.declarativeContent.ShowPageAction() ]
	  }
	]);
  });
});

*/
