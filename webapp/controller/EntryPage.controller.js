sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
    "use strict";

    return Controller.extend("creditedge.controller.EntryPage", {

        onInit: function () {
            // Shared UI-state model: controls footer visibility.
            // Set at Component level so DataView (nested view) can update it too.
            var oUiStateModel = new JSONModel({
                activeTab: "dataView",
                gridActive: false
            });
            this.getOwnerComponent().setModel(oUiStateModel, "uiState");
            this.getView().setModel(oUiStateModel, "uiState");
        },

        onTabSelect: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            var oUiStateModel = this.getOwnerComponent().getModel("uiState");
            oUiStateModel.setProperty("/activeTab", sKey);
        },

        // --- helper to reach the nested DataView controller ---
        _getDataViewController: function () {
            var oDataView = this.byId("dataView");
            return oDataView && oDataView.getController();
        },

        // --- footer button forwards ---
        onFooterGridPrevPage: function () {
            var oCtrl = this._getDataViewController();
            if (oCtrl) { oCtrl.onGridPrevPage(); }
        },

        onFooterGridNextPage: function () {
            var oCtrl = this._getDataViewController();
            if (oCtrl) { oCtrl.onGridNextPage(); }
        },

        onFooterGridJumpBack: function () {
            var oCtrl = this._getDataViewController();
            if (oCtrl) { oCtrl.onGridJumpBack(); }
        },

        onFooterGridJumpForward: function () {
            var oCtrl = this._getDataViewController();
            if (oCtrl) { oCtrl.onGridJumpForward(); }
        },

        onFooterGridPageNumberPress: function (oEvent) {
            var oCtrl = this._getDataViewController();
            if (oCtrl) { oCtrl.onGridPageNumberPress(oEvent); }
        }
    });
});