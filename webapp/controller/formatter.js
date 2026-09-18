sap.ui.define([], function () {
    "use strict";

    return {
        stateValue: function (sopValue) {
            var value = parseInt(sopValue, 10);

            if (isNaN(value)) {
                return "Error";
            }
            if (value >= 1 && value <= 2) {
                return "Error";
            } else if (value >= 3 && value <= 4) {
                return "Warning";
            } else if (value === 5) {
                return "Success";
            }

            return "None";
        },

        percentValue: function (sopValue) {
            var value = parseInt(sopValue, 10);

            if (isNaN(value)) {
                return 0;
            }
            if (value < 1) {
                value = 1;
            } else if (value > 5) {
                value = 5;
            }

            return Math.round((value / 5) * 100);
        },

        riskState: function (sRiskLevel) {
            var sValue = (sRiskLevel || "").trim().toLowerCase();

            switch (sValue) {
                case "reject":
                case "high":
                case "high risk":
                    return "Error";
                case "review":
                case "medium":
                case "caution":
                    return "Warning";
                case "approved":
                case "approve":
                case "low":
                case "low risk":
                    return "Success";
                default:
                    return "None";
            }
        },

        formatDateTime: function (sDate) {
            if (!sDate) return "";
            const oDate = new Date(sDate);
            if (isNaN(oDate.getTime())) return sDate;
            const oDateFormat = sap.ui.core.format.DateFormat.getDateTimeInstance({
                pattern: "dd MMM yyyy, HH:mm"
            });
            return oDateFormat.format(oDate);
        },

        actionState: function (sAction) {
            switch ((sAction || "").toUpperCase()) {
                case "APPROVE": return "Success";
                case "REJECT": return "Error";
                case "INITIATE": return "Information";
                default: return "None";
            }
        }
    };
});