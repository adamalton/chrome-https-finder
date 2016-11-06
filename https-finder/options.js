var switches = {
	autoswitch: true,
	notifyOnAutoswitch: true,
	syncDomains: false
};

var EXCLUDED_DOMAINS_STORAGE_KEY = 'https_finder_excluded_domains';
var FOUND_DOMAINS_STORAGE_KEY = 'https_finder_found_domains';
var DOMAINS_STORAGE;

var status_display_animation_timeout_1;
var status_display_animation_timeout_2;

//****************************** BOOLEAN OPTIONS ******************************


function saveChanges(e) {
	// Save values to storage and update state of child switches
	var switch_values = {};
	for(var switch_name in switches){
		var checkbox = document.getElementById(switch_name);
		switch_values[switch_name] = checkbox.checked;
	}
	chrome.storage.sync.set(
		switch_values,
		showSavedMessage
	);
}

function setStateOfChildSwitches(){
	console.log("setStateOfChildSwitches called");
	for(var switch_name in switches){
		var checkbox = document.getElementById(switch_name);
		var new_child_class = checkbox.checked ? 'child' : 'child disabled';
		var children = checkbox.parentElement.getElementsByClassName('child');
		for(var j=0; j < children.length; j++){
			var child = children[j];
			child.className = new_child_class;
		}
	}
}

function showSavedMessage() {
	// Update status to let user know options were saved.
	var $status = $("#status");
	clearTimeout(status_display_animation_timeout_1);
	clearTimeout(status_display_animation_timeout_2);
	$status.removeClass("hidden").addClass("visible");
	status_display_animation_timeout_1 = setTimeout(function() {
		// Add the CSS class to trigger the transition, then after that's done remove all classes
		// so that the height is set back to 0 (so that it doesn't cover up stuff on the page)
		$status.addClass("hidden");
		status_display_animation_timeout_2 = setTimeout(
			function(){$status.removeClass("hidden visible");},
			1000
		);
	}, 1100);
}


function fetchOptions() {
	chrome.storage.sync.get(
		switches, //defaults
		fetchOptionsCallback
	);
}


function fetchOptionsCallback(items){
	for(var switch_name in items){
		var value = items[switch_name];
		switches[switch_name] = value;
		document.getElementById(switch_name).checked = value;
	}
	setStateOfChildSwitches(); // we can only call this on page load after restoring the options
	setDomainsStorage();
	// These next 2 can only be called after setDomainsStorage() has been called
	fetchExcludedDomains();
	fetchKnownSecureDomains();
}

function setDomainsStorage(){
	// Set DOMAINS_STORAGE to chrome.storage.local or chrome.storage.sync based on the user's pref.
	var namespace = switches.syncDomains ? "sync" : "local";
	DOMAINS_STORAGE = chrome.storage[namespace];
}


// When the syncDomains setting goes from false to true, the background page script will combine
// the local lists of known/excluded domains with the ones in 'sync' storage (if any). So we need
// to listen to the changing of the domains lists and update the <ul>s in this page accordingly.
chrome.storage.onChanged.addListener(function(changes, namespace){
	if(namespace === "sync"){
		if(FOUND_DOMAINS_STORAGE_KEY in changes || EXCLUDED_DOMAINS_STORAGE_KEY in changes){
			// This is slightly crude, but it saves duplication!
			$("#excluded_domains li:not(.form)").remove();
			$("#secure_domains li").remove();
			fetchExcludedDomains();
			fetchKnownSecureDomains();
		}
	}
});

//****************************** EXCLUDED DOMAINS ******************************

function fetchExcludedDomains(){
	// Fetch the list of excluded domains from the user's sync'd storage
	DOMAINS_STORAGE.get(
		EXCLUDED_DOMAINS_STORAGE_KEY,
		setExcludedDomainsInList
	);
}

function addExcludedDomain(e){
	// Event handler for 'submit' event of form for adding an excluded domain
	var $input = $(this).find("input")
	var domain = $input.eq(0).val().trim();
	$input.val('');
	// Make the visual changes on the page, and let the async storage update stuff happen
	// afterwards
	addExcludedDomainToDisplayList(domain);
	updateEmptyExcludedDomainsDisplay();

	// Fetch the existing domains and add this one to it
	DOMAINS_STORAGE.get(
		EXCLUDED_DOMAINS_STORAGE_KEY,
		function(items){
			var domains = items[EXCLUDED_DOMAINS_STORAGE_KEY] || [];
			if(domains.indexOf(domain) !== -1){
				// If it's already in there, just bail
				return;
			}
			domains.push(domain);
			items[EXCLUDED_DOMAINS_STORAGE_KEY] = domains; // Necessary if the array was empty
			// Store the updated items
			console.log("Setting excluded domains:");
			console.log(items);
			DOMAINS_STORAGE.set(items, showSavedMessage);
		}
	);
	return false;
}

function removeExcludedDomain(e){
	// Event handler for the 'Remove' button for an excluded domain
	var $li = $(this).closest("li");
	var domain = $li.find("span").text().trim();
	$li.remove();
	updateEmptyExcludedDomainsDisplay();
	DOMAINS_STORAGE.get(
		EXCLUDED_DOMAINS_STORAGE_KEY,
		function(items){
			var domains = items[EXCLUDED_DOMAINS_STORAGE_KEY] || [];
			if(!domains.length){
				return;
			}
			var index = domains.indexOf(domain);
			if(index > -1){
				domains.splice(index, 1);
			}
			DOMAINS_STORAGE.set(items, showSavedMessage);
		}
	);
}

function addExcludedDomainToDisplayList(domain){
	// Given a domain name, add it to the <ul> which displays the list of excluded domains
	var $form_li = $("#excluded_domains li.form");
	var $li = $('<li/>');
	$('<span/>').text(domain).appendTo($li);
	$('<button/>').text("Remove").addClass("remove").appendTo($li);
	$li.insertBefore($form_li);
}

function updateEmptyExcludedDomainsDisplay(){
	// Show/hide the message that says that there aren't any exluded domains
	console.log("updateEmptyExcludedDomainsDisplay");
	console.log($("#excluded_domains li:not(.empty,.form)"));
	var $msg = $("#excluded_domains li.empty");
	if(!$("#excluded_domains li:not(.empty,.form)").length){
		$msg.show();
	}else{
		$msg.hide();
	}
}

function setExcludedDomainsInList(items){
	// Callback from chrome.storage.sync which gives us the user's list of excluded domains
	var domains = items[EXCLUDED_DOMAINS_STORAGE_KEY] || [];
	var $form = $("#excluded_domains li.form");
	var domain, $li;
	if(!domains.length){
		$li = $('<li/>').addClass("empty").text("No excluded domains set");
		$li.insertBefore($("#excluded_domains li.form"));
	}
	for(var i=0; i< domains.length; i++){
		addExcludedDomainToDisplayList(domains[i]);
	}
	updateEmptyExcludedDomainsDisplay();
}



//****************************** STORED SECURE DOMAINS ******************************


function fetchKnownSecureDomains(){
	DOMAINS_STORAGE.get(FOUND_DOMAINS_STORAGE_KEY, populateStoredSecureDomainsUl);
}

function populateStoredSecureDomainsUl(items){
	console.log("populateStoredSecureDomainsUl");
	var domains = items[FOUND_DOMAINS_STORAGE_KEY] || [];
	var $ul = $("#secure_domains");
	if(!domains.length){
		$('<li/>').addClass("empty").text("No domains found yet").appendTo($ul);
		return;
	}
	for(var i=0; i< domains.length; i++){
		$('<li/>').text(domains[i]).appendTo($ul);
	}
}



//****************************** INIT ******************************

function init(){
	fetchOptions();

	$(document).on('click', '#excluded_domains button.remove', removeExcludedDomain);
	$(document).on('submit', '#excluded_domains form', addExcludedDomain);

	for(var switch_name in switches){
		$("#" + switch_name).on('change', saveChanges);
		$("#" + switch_name).on('change', setStateOfChildSwitches);
	}

	console.log("init done");
}

init();
