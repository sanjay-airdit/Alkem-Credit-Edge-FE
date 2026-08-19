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
            this._sSearchQuery = "";
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

            const oSearchFilter = this._buildSearchFilter();
            if (oSearchFilter) {
                mBindingParams.filters.push(oSearchFilter);
            }
        },

        _buildSearchFilter: function () {
            const sQuery = (this._sSearchQuery || "").trim();
            if (!sQuery) {
                return null;
            }

            const _aSearchableFields = [
                "OrderNumber",
                // "Customer",
                // "AISummaryText",
                // "BusinessArea"
            ];

            const aFieldFilters = _aSearchableFields.map((sField) => {
                return new Filter({
                    path: sField,
                    operator: FilterOperator.Contains,
                    value1: sQuery
                });
            });

            return new Filter({
                filters: aFieldFilters,
                and: false
            });
        },

        onSearch: function (oEvent) {
            this._sSearchQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
            this._rebindWithSearch();
        },

        onSearchLiveChange: function (oEvent) {
            this._sSearchQuery = oEvent.getParameter("newValue") || "";
            // simple debounce so we don't refetch on every keystroke
            clearTimeout(this._iSearchDebounce);
            this._iSearchDebounce = setTimeout(() => {
                this._rebindWithSearch();
            }, 400);
        },

        _rebindWithSearch: function () {
            const oSmartTable = this.getView().byId("idSmartTable");
            if (oSmartTable) {
                oSmartTable.rebindTable(true);
            }
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

        _loadOrders: function () { },

        onOrderPress: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext();
        },

        onApprove: function (oEvent) { /* call approve API */ },
        onReject: function (oEvent) { /* call reject API */ },
        onReset: function (oEvent) { /* call reset API */ }
    });
});