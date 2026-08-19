sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "creditedge/controller/formatter"
], function (Controller, JSONModel, Filter, FilterOperator, formatter) {
    "use strict";
    return Controller.extend("creditedge.controller.DataView", {

        formatter: formatter,
        onInit: function () {
            const oKpiModel = new JSONModel({
                totalOrders: 12,
                inHold: 12,
                approved: 0,
                highRiskOrders: 2,
                avgDelayScore: 5.0,
                avgSopScore: 2.7
            });
            this.getView().setModel(oKpiModel, "kpiModel");
        },

        onBeforeRebindTable: function (oEvent) {
            const oSmartTable = oEvent.getSource();
            const mBindingParams = oEvent.getParameter("bindingParams");

            const oDateFormat = sap.ui.core.format.DateFormat.getDateInstance({ pattern: "yyyy-MM-dd" });
            const sTodayDate = oDateFormat.format(new Date());

            oSmartTable.setEntitySet(`ZC_CE_OrdersOnHold(p_date=datetime'${sTodayDate}T00:00:00')/Set`);

            mBindingParams.filters.push(
                // new Filter("OrderNumber", FilterOperator.EQ, "0000002147"),
            );
        },

        onViewSwitchChange: function (oEvent) {
            const oItem = oEvent.getParameter("item");
            const sKey = oItem ? oItem.getKey() : oEvent.getSource().getSelectedKey();
            const oView = this.getView();
            const oListBox = oView.byId("listViewBox");
            const oGridBox = oView.byId("gridViewBox");

            if (sKey === "list") {
                oListBox.setVisible(true);
                oGridBox.setVisible(false);
                oView.byId("idSmartTable").rebindTable(true);
            } else {
                oListBox.setVisible(false);
                oGridBox.setVisible(true);
            }
        },

        _loadOrders: function () {
        },

        onOrderPress: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext();
        },

        onApprove: function (oEvent) { /* call approve API */ },
        onReject: function (oEvent) { /* call reject API */ },
        onReset: function (oEvent) { /* call reset API */ }
    });
});