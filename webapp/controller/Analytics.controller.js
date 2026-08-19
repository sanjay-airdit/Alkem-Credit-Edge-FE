sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel"
], function (Controller, JSONModel) {
    "use strict";

    return Controller.extend("creditedge.controller.Analytics", {

        onInit: function () {
            var oModel = new JSONModel({
                summary: { approve: 0, review: 10, escalate: 2 },
                avgScore: { sopValue: "2.7/5", sopValuePct: 54, delay: "4.7/5", delayPct: 94, util: "1.3/5", utilPct: 26 },
                cumulativeScoreData: [],
                orderValueData: []
            });
            this.getView().setModel(oModel, "analytics");
            this._loadAnalytics();
        },

        _loadAnalytics: function () {
            // TODO: fetch aggregated stats from your backend and update the "analytics" model
        }
    });
});