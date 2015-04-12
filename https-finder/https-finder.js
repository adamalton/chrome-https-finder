
var onNavigationCommitted = function(details){
	console.log("onNavigationCommitted called");
	console.log(String(document.location));
	console.dir(details.url);
	checkIfSecureVersionAvailable(details);
};



var checkIfSecureVersionAvailable = function(details){
	var secure_url = details.url.replace(/^http:/, 'https:');
	var reqListener = function() {
		console.log("Secure version response:")
		console.dir(this);
		if(this.status === 200){
			secureVersionIsAvailable(details);
		}else{
			console.log("Secure version not available.")
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
	var secure_url = details.url.replace(/^http:/, 'https:');
	fetch(secure_url)
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
	chrome.pageAction.show(details.tabId);
};


var onPageActionClicked = function(tab){
	// fired when the user clicks the pageAction icon to switch to HTTPS
	console.log("onPageActionClicked called");
	console.dir(tab);
	var secure_url = tab.url.replace(/^http:/, 'https:');
	chrome.tabs.update({
		url: secure_url
	});
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
