// Saves options to chrome.storage.sync.
// Currently only works with checkboxes

var switches = {
	autoswitch: true,
	notifyOnAutoswitch: true
};

var EXCLUDED_DOMAINS_STORAGE_KEY = 'https_finder_excluded_domains';
var FOUND_DOMAINS_STORAGE_KEY = 'https_finder_found_domains';


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
	var status = document.getElementById('status');
	status.className = 'visible';
	setTimeout(function() {
		status.className = 'hidden';
	}, 750);
}


function fetchOptions() {
	chrome.storage.sync.get(
		switches, //defaults
		setOptionsInForm
	);
}


function setOptionsInForm(items){
	for(var switch_name in items){
		document.getElementById(switch_name).checked = items[switch_name];
	}
	setStateOfChildSwitches(); // we can only call this on page load after restoring the options
}



//****************************** EXCLUDED DOMAINS ******************************

function fetchExcludedDomains(){
	// Fetch the list of excluded domains from the user's sync'd storage
	chrome.storage.sync.get(
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
	chrome.storage.sync.get(
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
			chrome.storage.sync.set(items);
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
	chrome.storage.sync.get(
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
			chrome.storage.sync.set(items);
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


function loadStoredSecureDomains(){
	chrome.storage.local.get(FOUND_DOMAINS_STORAGE_KEY, populateStoredSecureDomainsUl);
}

function populateStoredSecureDomainsUl(items){
	console.log("asdlkfjasdfk");
	var domains = items[FOUND_DOMAINS_STORAGE_KEY];
	var ul = document.getElementById("secure_domains");
	var domain, li;
	if(!domains){
		domains = ["No domains found yet"];
	}
	for(var i=0; i< domains.length; i++){
		domain = domains[i];
		console.log(domain);
		li = document.createElement('li');
		li.innerHTML = domain;
		ul.appendChild(li);
	}
}



//****************************** INIT ******************************

function init(){
	fetchOptions();
	fetchExcludedDomains();
	loadStoredSecureDomains();

	$(document).on('click', '#excluded_domains button.remove', removeExcludedDomain);
	$(document).on('submit', '#excluded_domains form', addExcludedDomain);

	for(var switch_name in switches){
		$("#" + switch_name).on('change', saveChanges);
		$("#" + switch_name).on('change', setStateOfChildSwitches);
	}

	console.log("init done");
}

init();
