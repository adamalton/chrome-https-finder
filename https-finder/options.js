var switches = {
	autoswitch: true,
	notifyOnAutoswitch: true,
	syncDomains: false
};

var domainsStorage;

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
}


// When one of the lists of known/excluded domains is changed, update the page to reflect the
// changes
chrome.storage.onChanged.addListener(function(changes, namespace){
	if(FOUND_DOMAINS_STORAGE_KEY in changes || EXCLUDED_DOMAINS_STORAGE_KEY in changes){
		setExcludedDomainsInList();
		populateStoredSecureDomainsUl();
	}
});

//****************************** EXCLUDED DOMAINS ******************************


function addExcludedDomain(e){
	// Event handler for 'submit' event of form for adding an excluded domain
	var $input = $(this).find("input")
	var domain = $input.eq(0).val().trim();
	$input.val('');
	// Make the visual changes on the page, and let the async storage update stuff happen
	// afterwards
	addExcludedDomainToDisplayList(domain);
	updateEmptyExcludedDomainsDisplay();
	domainsStorage.addExcludedDomain(domain);
	return false;
}

function removeExcludedDomain(e){
	// Event handler for the 'Remove' button for an excluded domain
	var $li = $(this).closest("li");
	var domain = $li.find("span").text().trim();
	$li.remove(); // This isn't strictly necessary as the next line will trigger a callback
	domainsStorage.removeExcludedDomain(domain);
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
	// Take the list of excluded domains from storage and display it in the <ul>
	$("#excluded_domains li:not(.form)").remove();
	var domains = domainsStorage.getExcludedDomains();
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


function populateStoredSecureDomainsUl(items){
	// Take the list of known secure domains from storage and display them in the <ul>
	console.log("populateStoredSecureDomainsUl");
	$("#secure_domains li").remove();
	var domains = domainsStorage.getKnownSecureDomains();
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
	domainsStorage = chrome.extension.getBackgroundPage().domainsStorage;
	domainsStorage.addOnReadyListener(populateStoredSecureDomainsUl);
	domainsStorage.addOnReadyListener(setExcludedDomainsInList);

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
