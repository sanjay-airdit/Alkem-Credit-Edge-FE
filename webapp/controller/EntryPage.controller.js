sap.ui.define([
    "sap/ui/core/mvc/Controller"
], function (Controller) {
    "use strict";

    return Controller.extend("creditedge.controller.EntryPage", {

        onInit: function () {},

        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            // e.g. persist last selected tab, trigger refresh of that view's model
        }
    });
});