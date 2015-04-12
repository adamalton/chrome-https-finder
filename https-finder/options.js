// Saves options to chrome.storage.sync.
function save_options() {
	var autoswitch = document.getElementById('autoswitch').checked;
	chrome.storage.sync.set({
		autoswitch: autoswitch
	}, function() {
		// Update status to let user know options were saved.
		var status = document.getElementById('status');
		status.className = 'visible';
		setTimeout(function() {
			status.className = 'hidden';
		}, 750);
	});
}


function restore_options() {
	chrome.storage.sync.get({
		autoswitch: false //default value
	}, function(items) {
		document.getElementById('autoswitch').checked = items.autoswitch;
	});
}
document.addEventListener('DOMContentLoaded', restore_options);
document.getElementById('autoswitch').addEventListener('change', save_options);
