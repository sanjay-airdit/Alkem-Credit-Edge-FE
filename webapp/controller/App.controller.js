sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Fragment",
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel"
], function (Controller, Fragment, MessageToast, JSONModel) {
    "use strict";

    return Controller.extend("creditedge.controller.App", {

        onInit: function () {
            var oAirbotModel = new JSONModel({
                messages: [
                    { role: "bot", text: "Hi, Ask me about orders, credit risk, or delay scores." }
                ],
                busy: false
            });
            this.getView().setModel(oAirbotModel, "airbot");
            this._pAirbotPopover = null;
        },

        onSetTheme: function () {
            var core = sap.ui.getCore();
            var current = core.getConfiguration().getTheme();
            var isDark = current.indexOf("dark") > -1;
            core.applyTheme(isDark ? "sap_horizon" : "sap_horizon_dark");
        },

        onNotification: function (oEvent) {
            MessageToast.show("No new notifications");
        },

        onProfilePress: function (oEvent) {
            var oButton = oEvent.getSource();
            var oView = this.getView();

            if (!this._pProfilePopover) {
                this._pProfilePopover = Fragment.load({
                    id: oView.getId(),
                    name: "creditedge.fragment.ProfilePopover",
                    controller: this
                }).then(function (oPopover) {
                    oView.addDependent(oPopover);
                    return oPopover;
                });
            }

            this._pProfilePopover.then(function (oPopover) {
                oPopover.openBy(oButton);
            });
        },

        onLogout: function () {
            // clear session / navigate to login
            MessageToast.show("Logging out...");
        },

        // ===================== AIRBOT =====================

        onAirbotTogglePress: function (oEvent) {
            var oButton = oEvent.getSource();
            this._getAirbotPopover().then(function (oPopover) {
                if (oPopover.isOpen()) {
                    oPopover.close();
                } else {
                    oPopover.openBy(oButton);
                }
            });
        },

        onAirbotClosePress: function () {
            if (this._pAirbotPopover) {
                this._pAirbotPopover.then(function (oPopover) {
                    oPopover.close();
                });
            }
        },

        onAirbotSend: function () {
            var oView = this.getView();
            var oInput = oView.byId("airbotInput");
            var sText = oInput.getValue().trim();

            if (!sText) {
                return;
            }

            var oModel = oView.getModel("airbot");
            var aMessages = oModel.getProperty("/messages");

            aMessages.push({ role: "user", text: sText });
            oModel.setProperty("/messages", aMessages);
            oModel.setProperty("/busy", true);
            oInput.setValue("");

            this._scrollAirbotToBottom();

            // Replace with actual AIRBOT backend call
            this._callAirbotBackend(sText).then(function (sReply) {
                aMessages.push({ role: "bot", text: sReply });
                oModel.setProperty("/messages", aMessages);
                oModel.setProperty("/busy", false);
                this._scrollAirbotToBottom();
            }.bind(this)).catch(function () {
                aMessages.push({ role: "bot", text: "Sorry, I couldn't process that. Please try again." });
                oModel.setProperty("/messages", aMessages);
                oModel.setProperty("/busy", false);
            });
        },

        _callAirbotBackend: function (sQuery) {
            // TODO: wire to real endpoint, e.g. POST /api/airbot/query
            return new Promise(function (resolve) {
                setTimeout(function () {
                    resolve("This is a placeholder response for: \"" + sQuery + "\"");
                }, 800);
            });
        },

        _scrollAirbotToBottom: function () {
            var oList = this.getView().byId("airbotMessageList");
            if (oList) {
                setTimeout(function () {
                    var oDom = oList.getDomRef();
                    if (oDom) {
                        oDom.scrollTop = oDom.scrollHeight;
                    }
                }, 50);
            }
        },

        _getAirbotPopover: function () {
            if (!this._pAirbotPopover) {
                this._pAirbotPopover = Fragment.load({
                    id: this.getView().getId(),
                    name: "creditedge.fragment.Airbot",
                    controller: this
                }).then(function (oPopover) {
                    this.getView().addDependent(oPopover);
                    return oPopover;
                }.bind(this));
            }
            return this._pAirbotPopover;
        }
    });
});