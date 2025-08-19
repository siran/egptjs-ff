const API = typeof browser !== "undefined" ? browser : chrome;
API.devtools.panels.create("RDP Chat", "", "panel.html");
