// Saves options to chrome.storage.sync.
// Currently only works with checkboxes

var switches = {
	autoswitch: false,
	notifyOnAutoswitch: true
};

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


function restoreOptions() {
	chrome.storage.sync.get(
		switches, //defaults
		function(items) {
			for(var switch_name in items){
				document.getElementById(switch_name).checked = items[switch_name];
			}
			setStateOfChildSwitches(); // we can only call this on page load after restoring the options
		}
	);
}

document.addEventListener('DOMContentLoaded', restoreOptions);

for(var switch_name in switches){
	document.getElementById(switch_name).addEventListener('change', saveChanges);
	document.getElementById(switch_name).addEventListener('change', setStateOfChildSwitches);
}
