sap.ui.define([], function () {
    "use strict";

    return {
        stateValue: function (sopValue) {
            var value = parseInt(sopValue, 10);

            if (isNaN(value)) {
                return "None";
            }
            if (value >= 1 && value <= 5) {
                return "Error";
            } else if (value >= 6 && value <= 10) {
                return "Warning";
            } else if (value >= 11 && value <= 15) {
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
            } else if (value > 15) {
                value = 15;
            }

            return Math.round((value / 15) * 100);
        }
    };
});