# HTTPS Finder

This is an extension for the Google Chrome web browser which detects if any page that you view on HTTP is available on HTTPS, and gives you the option to switch.

This extension is intended as a supplement to the EFF's HTTPS Everywhere extension which automatically switches you to HTTPS, but only for a known list of domains, whereas this extension automatically detects if a page is available on HTTPS.

# Road Map

1. Add an options page, which gives the user the ability to enable the following functionalities:
  - Switch to the HTTPS version automatically if it's available.
  - Only switch to the HTTPS version automatically if no interaction with the page has taken place yet.
1. Store a local list of domains which we know (from previous visits) are available on HTTPS, and switch to the HTTPS version before loading the page.
1. Allow the user to submit their list of known HTTPS-enabled domains to the EFF, so that they can be included in the HTTPS Everywhere extension.
