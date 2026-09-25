sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/format/DateFormat",
    "sap/ui/core/Fragment",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/FormattedText",
    "creditedge/controller/formatter",
    "sap/m/MessageBox",
    "sap/ui/core/BusyIndicator"
], function (Controller, JSONModel, Filter, FilterOperator, DateFormat, Fragment, Dialog, Button, FormattedText, formatter, MessageBox, BusyIndicator) {
    "use strict";
    return Controller.extend("creditedge.controller.DataView", {

        formatter: formatter,

        // Default filter period, reused by both List (SmartTable) and Grid views
        _oDefaultFilterDates: {
            fromDate: new Date(2023, 8, 1),  // 2023-09-01
            toDate: new Date(2023, 8, 30)    // 2023-09-30
        },

        // Status tab keys — must match the values coming from the backend field
        // used in _buildFilterBarFilters (currently status).
        _sDefaultStatusTab: "HOLD",

        onInit: function () {
            const oKpiModel = new JSONModel({
                TotalOrders: 0,
                InHold: 0,
                ApprovedOrders: 0,
                HighRiskOrders: 0,
                AvgDelayScore: 0,
                avgSopScore: 0
            });
            this.getView().setModel(oKpiModel, "kpiModel");
            this._sSearchQuery = "";

            // --- Filter bar model (shared by List + Grid views) ---
            const oFilterModel = new JSONModel({
                fromDate: new Date(this._oDefaultFilterDates.fromDate),
                toDate: new Date(this._oDefaultFilterDates.toDate),
                recommendation: "",
                customer: "",
                division: "",
                businessArea: "",
                orderNumber: "",
                statusTab: this._sDefaultStatusTab   // <-- NEW: drives the IconTabBar
            });
            this.getView().setModel(oFilterModel, "filterModel");

            // --- Grid/card pagination setup ---
            this._iPageSize = 20;
            this._iJumpSize = 9;
            this._bGridLoaded = false;

            const oOrdersModel = new JSONModel({
                orders: [],
                busy: false,
                noData: false,
                currentPage: 1,
                totalPages: 1,
                totalCount: 0,
                pageNumbers: []
            });
            oOrdersModel.setSizeLimit(1000);

            this.getView().setModel(oOrdersModel, "ordersModel");
            this.getOwnerComponent().setModel(oOrdersModel, "ordersModel");

            this._preloadGridData();

            const oSmartTable = this.byId("idSmartTable")
            const customizeConfig = {
                autoColumnWidth: {
                    '*': { min: 2, max: 6, gap: 1, truncateLabel: false },
                }
            };
            oSmartTable.setCustomizeConfig(customizeConfig);
        },

        _preloadGridData: function () {
            const oModel = this.getOwnerComponent().getModel();

            if (oModel) {
                this._loadGridPage(1);
                this._loadKpiData();
            } else {
                const oView = this.getView();
                oView.attachEventOnce("modelContextChange", () => {
                    if (this.getView().getModel() && !this._bGridLoaded) {
                        this._loadGridPage(1);
                        this._loadKpiData();
                    }
                });
            }
        },

        _getFormattedFilterDates: function () {
            const oFilterModel = this.getView().getModel("filterModel");
            const oDateFormat = DateFormat.getDateInstance({ pattern: "yyyy-MM-dd" });

            const oFromDate = (oFilterModel && oFilterModel.getProperty("/fromDate")) || this._oDefaultFilterDates.fromDate;
            const oToDate = (oFilterModel && oFilterModel.getProperty("/toDate")) || this._oDefaultFilterDates.toDate;

            return {
                from: oDateFormat.format(oFromDate),
                to: oDateFormat.format(oToDate)
            };
        },

        _buildSearchFilter: function () {
            const sQuery = (this._sSearchQuery || "").trim();
            if (!sQuery) {
                return null;
            }

            const _aSearchableFields = [
                "OrderNumber",
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

        _buildFilterBarFilters: function () {
            const oFilterModel = this.getView().getModel("filterModel");
            if (!oFilterModel) {
                return [];
            }

            const oData = oFilterModel.getData();
            const aFilters = [];

            // --- NEW: Status tab filter (On Hold / Rejected) ---
            // ASSUMPTION: status lives on status with values "HOLD" / "REJECTED".
            // If your backend uses a different field/values, change path/value1 below.
            if (oData.statusTab) {
                aFilters.push(new Filter({
                    path: "status",
                    operator: FilterOperator.EQ,
                    value1: oData.statusTab
                }));
            }

            if (oData.recommendation && oData.recommendation.trim()) {
                aFilters.push(new Filter({
                    path: "AISummaryVerdict",
                    operator: FilterOperator.Contains,
                    value1: oData.recommendation.trim()
                }));
            }
            if (oData.customer && oData.customer.trim()) {
                aFilters.push(new Filter({
                    path: "Customer",
                    operator: FilterOperator.Contains,
                    value1: oData.customer.trim()
                }));
            }
            if (oData.division && oData.division.trim()) {
                aFilters.push(new Filter({
                    path: "Division",
                    operator: FilterOperator.Contains,
                    value1: oData.division.trim()
                }));
            }
            if (oData.businessArea && oData.businessArea.trim()) {
                aFilters.push(new Filter({
                    path: "BusinessArea",
                    operator: FilterOperator.Contains,
                    value1: oData.businessArea.trim()
                }));
            }
            if (oData.orderNumber && oData.orderNumber.trim()) {
                aFilters.push(new Filter({
                    path: "OrderNumber",
                    operator: FilterOperator.Contains,
                    value1: oData.orderNumber.trim()
                }));
            }

            return aFilters;
        },

        _buildODataFilters: function () {
            const aAndFilters = [];

            const oSearchFilter = this._buildSearchFilter();
            if (oSearchFilter) {
                aAndFilters.push(oSearchFilter);
            }

            aAndFilters.push(...this._buildFilterBarFilters());

            if (aAndFilters.length === 0) {
                return null;
            }

            return new Filter({
                filters: aAndFilters,
                and: true
            });
        },

        onBeforeRebindTable: function (oEvent) {
            const oSmartTable = oEvent.getSource();
            const mBindingParams = oEvent.getParameter("bindingParams");

            const oDates = this._getFormattedFilterDates();

            oSmartTable.setEntitySet(`ZC_CE_OrdersOnHold(p_from_date=datetime'${oDates.from}T00:00:00',p_date=datetime'${oDates.to}T00:00:00')/Set`);

            const oCombinedFilter = this._buildODataFilters();
            if (oCombinedFilter) {
                mBindingParams.filters.push(oCombinedFilter);
            }
        },

        onSearch: function (oEvent) {
            this._sSearchQuery = oEvent.getParameter("query") || oEvent.getParameter("newValue") || "";
            this._rebindWithSearch();
        },

        onSearchLiveChange: function (oEvent) {
            this._sSearchQuery = oEvent.getParameter("newValue") || "";
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
            this._loadGridPage(1);
        },

        onFilterSearch: function () {
            const oSmartTable = this.byId("idSmartTable");
            if (oSmartTable) {
                oSmartTable.rebindTable(true);
            }
            this._loadGridPage(1);
            this._loadKpiData();
        },

        onFilterClear: function () {
            const oFilterModel = this.getView().getModel("filterModel");
            oFilterModel.setData({
                fromDate: new Date(this._oDefaultFilterDates.fromDate),
                toDate: new Date(this._oDefaultFilterDates.toDate),
                recommendation: "",
                customer: "",
                division: "",
                businessArea: "",
                orderNumber: "",
                statusTab: oFilterModel.getProperty("/statusTab") || this._sDefaultStatusTab // keep current tab on clear
            });
            this.onFilterSearch();
        },

        // --- NEW: IconTabBar select handler for the SmartTable's status tabs ---
        onStatusTabSelect: function (oEvent) {
            const sKey = oEvent.getParameter("key");
            const oFilterModel = this.getView().getModel("filterModel");
            oFilterModel.setProperty("/statusTab", sKey);
            this.onFilterSearch();
        },

        onViewSwitchChange: function (oEvent) {
            const oItem = oEvent.getParameter("item");
            const sKey = oItem ? oItem.getKey() : oEvent.getSource().getSelectedKey();
            const oView = this.getView();
            const oListBox = oView.byId("listViewBox");
            const oGridBox = oView.byId("gridViewBox");

            const oUiStateModel = this.getOwnerComponent().getModel("uiState");
            if (oUiStateModel) {
                oUiStateModel.setProperty("/gridActive", sKey === "grid");
            }

            if (sKey === "list") {
                oListBox.setVisible(true);
                oGridBox.setVisible(false);
            } else {
                oListBox.setVisible(false);
                oGridBox.setVisible(true);
                if (!this._bGridLoaded) {
                    this._loadGridPage(1);
                }
            }
        },

        _getGridEntityPath: function () {
            const oDates = this._getFormattedFilterDates();
            return `/ZC_CE_OrdersOnHold(p_from_date=datetime'${oDates.from}T00:00:00',p_date=datetime'${oDates.to}T00:00:00')/Set`;
        },

        _loadGridPage: function (iPage) {
            const oView = this.getView();
            let oModel = oView.getModel();
            const oOrdersModel = oView.getModel("ordersModel");
            const sPath = this._getGridEntityPath();
            const iSkip = (iPage - 1) * this._iPageSize;

            if (!oModel) {
                oModel = this.getOwnerComponent().getModel();
            }

            const aFilters = [];
            const oCombinedFilter = this._buildODataFilters();
            if (oCombinedFilter) {
                aFilters.push(oCombinedFilter);
            }

            oOrdersModel.setProperty("/busy", true);
            oOrdersModel.setProperty("/noData", false);

            const aSelectFields = [
                "OrderNumber",
                "Customer",
                "AISummaryText",
                "AISummaryVerdict",
                "AISopValueScore",
                "AIAverageDelayScore",
                "AIUtilPercentageScore",
                "CurrentOrderValue",
                "Currency",
                "AIUtilizationPercentage",
                "CreditEsposure",
                "SDDocumentCategory",
                "Grade",
                "status"
            ];

            oModel.read(sPath, {
                urlParameters: {
                    "$skip": iSkip,
                    "$top": this._iPageSize,
                    "$inlinecount": "allpages",
                    "$select": aSelectFields.join(",")
                },
                filters: aFilters,
                success: (oData) => {
                    this._bGridLoaded = true;
                    const aResults = (oData && oData.results) || [];
                    const iTotalCount = oData && oData.__count ? parseInt(oData.__count, 10) : aResults.length;
                    const iTotalPages = Math.max(1, Math.ceil(iTotalCount / this._iPageSize));
                    const iClampedPage = Math.min(Math.max(1, iPage), iTotalPages);

                    oOrdersModel.setData({
                        orders: aResults,
                        busy: false,
                        noData: aResults.length === 0,
                        currentPage: iClampedPage,
                        totalPages: iTotalPages,
                        totalCount: iTotalCount,
                        pageNumbers: this._buildPageNumbers(iClampedPage, iTotalPages)
                    });

                },
                error: (oError) => {
                    oOrdersModel.setProperty("/busy", false);
                    oOrdersModel.setProperty("/orders", []);
                    oOrdersModel.setProperty("/noData", true);
                    sap.m.MessageToast.show("Failed to load orders. Please try again.");
                }
            });
        },

        _loadKpiData: function () {
            const oView = this.getView();
            const oModel = oView.getModel("ZUI_CE_APPR_MATRIX_SB")
                || this.getOwnerComponent().getModel("ZUI_CE_APPR_MATRIX_SB");
            const oKpiModel = oView.getModel("kpiModel");

            if (!oModel || !oKpiModel) {
                return;
            }

            const oDates = this._getFormattedFilterDates();
            const sPath = `/ZC_CE_ORDER_KPI%28p_from_date%3Ddatetime%27${oDates.from}T00%3A00%3A00%27%2Cp_date%3Ddatetime%27${oDates.to}T00%3A00%3A00%27%29/Set`;
            // const sPath = `/ZC_CE_ORDER_KPI(p_from_date=datetime'${oDates.from}T00:00:00',p_date=datetime'${oDates.to}T00:00:00')/Set`;

            oModel.read(sPath, {
                success: (oData) => {
                    const aResults = (oData && oData.results) || [];
                    const oKpi = aResults[0] || {};

                    const oDefaults = oKpiModel.getData();
                    oKpiModel.setData({ ...oDefaults, ...oKpi });
                },
                error: (oError) => {
                    sap.m.MessageToast.show("Failed to load KPI data.");
                }
            });
        },

        _buildPageNumbers: function (iCurrent, iTotal) {
            const iBoundaryStart = 1;
            const iBoundaryEnd = 1;
            const iSiblingCount = 1;

            const aRawSet = new Set();

            for (let p = 1; p <= Math.min(iBoundaryStart, iTotal); p++) {
                aRawSet.add(p);
            }
            for (let p = iCurrent - iSiblingCount; p <= iCurrent + iSiblingCount; p++) {
                if (p >= 1 && p <= iTotal) {
                    aRawSet.add(p);
                }
            }
            for (let p = Math.max(1, iTotal - iBoundaryEnd + 1); p <= iTotal; p++) {
                aRawSet.add(p);
            }

            const aSorted = Array.from(aRawSet).sort((a, b) => a - b);

            const aPages = [];
            let iPrev = 0;
            aSorted.forEach((p) => {
                if (iPrev && p - iPrev > 1) {
                    aPages.push({ text: "...", page: -1, enabled: false, emphasized: false });
                }
                aPages.push({
                    text: String(p),
                    page: p,
                    enabled: p !== iCurrent,
                    emphasized: p === iCurrent
                });
                iPrev = p;
            });

            return aPages;
        },

        onGridPrevPage: function () {
            const oOrdersModel = this.getView().getModel("ordersModel");
            const iCurrent = oOrdersModel.getProperty("/currentPage");
            if (iCurrent > 1) {
                this._loadGridPage(iCurrent - 1);
            }
        },

        onGridNextPage: function () {
            const oOrdersModel = this.getView().getModel("ordersModel");
            const iCurrent = oOrdersModel.getProperty("/currentPage");
            const iTotal = oOrdersModel.getProperty("/totalPages");
            if (iCurrent < iTotal) {
                this._loadGridPage(iCurrent + 1);
            }
        },

        onGridJumpBack: function () {
            const oOrdersModel = this.getView().getModel("ordersModel");
            const iCurrent = oOrdersModel.getProperty("/currentPage");
            if (iCurrent > 1) {
                const iTarget = Math.max(1, iCurrent - this._iJumpSize);
                this._loadGridPage(iTarget);
            }
        },

        onGridJumpForward: function () {
            const oOrdersModel = this.getView().getModel("ordersModel");
            const iCurrent = oOrdersModel.getProperty("/currentPage");
            const iTotal = oOrdersModel.getProperty("/totalPages");
            if (iCurrent < iTotal) {
                const iTarget = Math.min(iTotal, iCurrent + this._iJumpSize);
                this._loadGridPage(iTarget);
            }
        },

        onGridPageNumberPress: function (oEvent) {
            const oButton = oEvent.getSource();
            const oCustomData = oButton.getCustomData().find((d) => d.getKey() === "page");
            const iPage = oCustomData ? parseInt(oCustomData.getValue(), 10) : -1;
            if (iPage > 0) {
                this._loadGridPage(iPage);
            }
        },

        _loadOrders: function () { },

        onOrderPress: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext();
        },

        _refreshAllViews: function () {
            const oSmartTable = this.byId("idSmartTable");
            if (oSmartTable) {
                oSmartTable.rebindTable(true);
            }

            const oOrdersModel = this.getView().getModel("ordersModel");
            const iCurrentPage = oOrdersModel ? oOrdersModel.getProperty("/currentPage") : 1;
            this._loadGridPage(iCurrentPage || 1);
            this._loadKpiData();
        },


        onApprove: function (oEvent) {
            const oOrder = this._getOrderFromEvent(oEvent);
            const sOrderNumber = oOrder?.OrderNumber;

            if (!sOrderNumber) {
                MessageBox.error("No order selected.");
                return;
            }

            this._openCommentDialog({
                action: "approve",
                orderNumber: sOrderNumber,
                docCategory: oOrder.SDDocumentCategory || "C",
                title: `Approve Order ${sOrderNumber}`,
                confirmButtonText: "Approve"
            });
        },

        onReject: function (oEvent) {
            const oOrder = this._getOrderFromEvent(oEvent);
            const sOrderNumber = oOrder?.OrderNumber;

            if (!sOrderNumber) {
                MessageBox.error("No order selected.");
                return;
            }

            this._openCommentDialog({
                action: "reject",
                orderNumber: sOrderNumber,
                docCategory: oOrder.SDDocumentCategory || "C",
                title: `Reject Order ${sOrderNumber}`,
                confirmButtonText: "Reject"
            });
        },

        onReInitiate: function (oEvent) {
            const oOrder = this._getOrderFromEvent(oEvent);
            const sOrderNumber = oOrder?.OrderNumber;

            if (!sOrderNumber) {
                MessageBox.error("No order selected.");
                return;
            }

            this._openCommentDialog({
                action: "reinitiate",
                orderNumber: sOrderNumber,
                docCategory: oOrder.SDDocumentCategory || "C",
                title: `ReInitiate Order ${sOrderNumber}`,
                confirmButtonText: "ReInitiate"
            });
        },

        _openCommentDialog: function (oPending) {
            this._oPendingAction = oPending;

            const fnShowDialog = (oDialog) => {
                if (!this._oCommentModel) {
                    this._oCommentModel = new JSONModel();
                    oDialog.setModel(this._oCommentModel, "commentModel");
                }

                this._oCommentModel.setData({
                    title: oPending.title,
                    confirmButtonText: oPending.confirmButtonText,
                    comment: "",
                    valueState: "None",
                    valueStateText: ""
                });

                oDialog.open();
            };

            if (this._oCommentDialog) {
                fnShowDialog(this._oCommentDialog);
                return;
            }

            Fragment.load({
                id: this.getView().getId(),
                name: "creditedge.fragment.CommentDialog",
                controller: this
            }).then((oDialog) => {
                this._oCommentDialog = oDialog;
                this.getView().addDependent(oDialog);
                fnShowDialog(oDialog);
            }).catch((oError) => {
                MessageBox.error("Failed to load Comment dialog.");
            });
        },

        onCommentLiveChange: function (oEvent) {
            const sValue = oEvent.getParameter("value") || "";
            if (sValue.trim()) {
                this._oCommentModel.setProperty("/valueState", "None");
                this._oCommentModel.setProperty("/valueStateText", "");
            }
        },

        onCommentDialogCancel: function () {
            this._oPendingAction = null;
            if (this._oCommentDialog) {
                this._oCommentDialog.close();
            }
        },

        onCommentDialogConfirm: function () {
            const sComment = (this._oCommentModel.getProperty("/comment") || "").trim();

            if (!sComment) {
                this._oCommentModel.setProperty("/valueState", "Error");
                this._oCommentModel.setProperty("/valueStateText", "Comment is required.");
                return;
            }

            const oPending = this._oPendingAction;

            if (this._oCommentDialog) {
                this._oCommentDialog.close();
            }

            if (!oPending) {
                return;
            }

            if (oPending.action === "approve") {
                this._executeApprove(oPending.orderNumber, oPending.docCategory, sComment);
            } else if (oPending.action === "reject") {
                this._executeReject(oPending.orderNumber, sComment);
            } else if (oPending.action === "reinitiate") {
                this._executeReInitiate(oPending.orderNumber, oPending.docCategory, sComment);
            }

            this._oPendingAction = null;
        },

        _executeApprove: function (sOrderNumber, sDocCategory, sUserComment) {
            const oModel = this.getView().getModel("ZUI_CE_APPR_MATRIX_SB");

            BusyIndicator.show(0);

            oModel.callFunction("/approve", {
                method: "POST",
                urlParameters: {
                    Vbeln: sOrderNumber,
                    UserComment: sUserComment
                },
                success: (oData, oResponse) => {
                    BusyIndicator.hide();

                    const oSapMessage = JSON.parse(oResponse?.headers['sap-message']);
                    const sSeverity = oSapMessage?.severity;
                    const sMessageText = oSapMessage?.message || "";

                    if (sSeverity && sSeverity.includes('error')) {
                        return MessageBox.error(sMessageText);
                    }

                    if (sMessageText.includes("Final approval completed") && sMessageText.includes("ready for release")) {
                        this._releaseCreditBlock(sOrderNumber, sDocCategory);
                        return;
                    }

                    this._refreshAllViews();
                    MessageBox.success(`Order Number - ${sOrderNumber} Approved`);
                },
                error: (oError) => {
                    BusyIndicator.hide();
                    MessageBox.error("Failed to approve order " + sOrderNumber);
                }
            });
        },

        _executeReject: function (sOrderNumber, sUserComment) {
            const oModel = this.getView().getModel("ZUI_CE_APPR_MATRIX_SB");

            BusyIndicator.show(0);

            oModel.callFunction("/reject", {
                method: "POST",
                urlParameters: {
                    Vbeln: sOrderNumber,
                    UserComment: sUserComment
                },
                success: (oData, oResponse) => {
                    BusyIndicator.hide();
                    const severity = JSON.parse(oResponse?.headers['sap-message'])?.severity;
                    if (severity.includes('error')) {
                        return MessageBox.error(`${JSON.parse(oResponse?.headers['sap-message'])?.message}`)
                    }
                    MessageBox.success(`Order Number - ${sOrderNumber} Rejected`);
                    this._refreshAllViews();
                },
                error: (oError) => {
                    BusyIndicator.hide();
                    MessageBox.error(`Failed to Reject Order Number - ${sOrderNumber}`);
                }
            });
        },

        _executeReInitiate: function (sOrderNumber, sDocCategory, sUserComment) {
            const oModel = this.getView().getModel("ZUI_CE_APPR_MATRIX_SB");

            BusyIndicator.show(0);

            oModel.callFunction("/reinitiate", {
                method: "POST",
                urlParameters: {
                    Vbeln: sOrderNumber,
                    UserComment: sUserComment
                },
                success: (oData, oResponse) => {
                    BusyIndicator.hide();

                    const oSapMessage = JSON.parse(oResponse?.headers['sap-message']);
                    const sSeverity = oSapMessage?.severity;
                    const sMessageText = oSapMessage?.message || "";

                    if (sSeverity && sSeverity.includes('error')) {
                        return MessageBox.error(sMessageText);
                    }

                    if (sMessageText.includes("Final approval completed") && sMessageText.includes("ready for release")) {
                        this._releaseCreditBlock(sOrderNumber, sDocCategory);
                        return;
                    }

                    this._refreshAllViews();
                    MessageBox.success(`Order Number - ${sOrderNumber} ReInitiated`);
                },
                error: (oError) => {
                    BusyIndicator.hide();
                    MessageBox.error("Failed to reinitiate order " + sOrderNumber);
                }
            });
        },

        _releaseCreditBlock: function (sOrderNumber, sDocCategory) {
            const oCreditModel = this.getOwnerComponent().getModel("API_SLS_DOC_WITH_CREDIT_BLOCK");

            if (!oCreditModel) {
                MessageBox.error("Credit block release service is not configured.");
                return;
            }

            BusyIndicator.show(0);

            oCreditModel.callFunction("/ReleaseCreditBlock", {
                method: "POST",
                urlParameters: {
                    SalesDocument: sOrderNumber,
                    SDDocumentCategory: sDocCategory
                },
                success: (oData, oResponse) => {
                    BusyIndicator.hide();
                    MessageBox.success(`Credit block released for Order ${sOrderNumber}`);
                    this._refreshAllViews();
                },
                error: (oError) => {
                    BusyIndicator.hide();
                    MessageBox.error(`Failed to release credit block for Order ${sOrderNumber}`);
                }
            });
        },

        onView: function (oEvent) {
            const oOrder = this._getOrderFromEvent(oEvent);
            const sOrderNumber = oOrder?.OrderNumber;

            if (!sOrderNumber) {
                MessageBox.error("No order selected.");
                return;
            }

            const oModel = this.getView().getModel("ZUI_CE_APPR_MATRIX_SB");

            BusyIndicator.show(0);

            oModel.callFunction("/get_log", {
                method: "POST",
                urlParameters: {
                    Vbeln: sOrderNumber,
                    UserComment: ""
                },
                success: (oData, oResponse) => {
                    BusyIndicator.hide();
                    const aResults = (oData && oData.results) || [];
                    this._openApprovalLogDialog(sOrderNumber, aResults);
                },
                error: (oError) => {
                    BusyIndicator.hide();
                    MessageBox.error(`Failed to Fetch Logs Order Number - ${sOrderNumber}`);
                }
            });
        },

        _openApprovalLogDialog: function (sOrderNumber, aResults) {
            const fnShowDialog = (oDialog) => {
                if (!this._oLogModel) {
                    this._oLogModel = new JSONModel({ logs: [] });
                    oDialog.setModel(this._oLogModel, "logModel");
                }

                this._oLogModel.setProperty("/logs", aResults);
                oDialog.setTitle(sOrderNumber ? `Approval Log (${sOrderNumber})` : "Approval Log");
                oDialog.open();
            };

            if (this._oApprovalLogDialog) {
                fnShowDialog(this._oApprovalLogDialog);
                return;
            }

            Fragment.load({
                id: this.getView().getId(),
                name: "creditedge.fragment.ApprovalLogDialog",
                controller: this
            }).then((oDialog) => {
                this._oApprovalLogDialog = oDialog;
                this.getView().addDependent(oDialog);
                fnShowDialog(oDialog);
            }).catch((oError) => {
                MessageBox.error("Failed to load Approval Log dialog.");
            });
        },

        onCloseApprovalLog: function () {
            if (this._oApprovalLogDialog) {
                this._oApprovalLogDialog.close();
            }
        },

        _getOrderFromEvent: function (oEvent) {
            const oSource = oEvent.getSource();
            const oCtx = oSource.getBindingContext("ordersModel") || oSource.getBindingContext();
            return oCtx && oCtx.getObject();
        },

        formatSummaryHtml: function (sText) {
            if (!sText) {
                return "<p><em>No summary available.</em></p>";
            }

            const sEscaped = String(sText)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            const aLines = sEscaped.replace(/\r\n/g, "\n").split("\n");

            let sHtml = "";
            let bInList = false;

            const closeList = () => {
                if (bInList) {
                    sHtml += "</ul>";
                    bInList = false;
                }
            };

            const applyInline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

            aLines.forEach((sRawLine) => {
                const sLine = sRawLine.trim();

                if (!sLine) {
                    closeList();
                    return;
                }

                const oHeaderMatch = sLine.match(/^(#{1,6})\s+(.*)$/);
                if (oHeaderMatch) {
                    closeList();
                    const iLevel = Math.min(oHeaderMatch[1].length, 6);
                    const sContent = applyInline(oHeaderMatch[2]);
                    sHtml += `<h5>${sContent}</h5>`;
                    return;
                }

                const oBulletMatch = sLine.match(/^[*-]\s+(.*)$/);
                if (oBulletMatch) {
                    if (!bInList) {
                        sHtml += "<ul>";
                        bInList = true;
                    }
                    sHtml += `<li>${applyInline(oBulletMatch[1])}</li>`;
                    return;
                }

                const oStandaloneBold = sLine.match(/^\*\*(.+?)\*\*:?\s*$/);
                if (oStandaloneBold) {
                    closeList();
                    sHtml += `<h3>${oStandaloneBold[1]}</h3>`;
                    return;
                }

                closeList();
                sHtml += `<p>${applyInline(sLine)}</p>`;
            });

            closeList();
            return sHtml;
        },

        onViewSummary: function (oEvent) {
            const oSource = oEvent.getSource();
            const oBindingContext = oSource.getBindingContext("ordersModel") || oSource.getBindingContext();
            const oData = oBindingContext && oBindingContext.getObject();

            if (!oData) {
                return;
            }

            const sHtml = this.formatSummaryHtml(oData.AISummaryText);

            if (!this._oSummaryDialog) {
                this._oSummaryModel = new JSONModel({ html: "" });

                this._oSummaryFormattedText = new FormattedText({
                    htmlText: "{summaryDialog>/html}"
                });
                this._oSummaryFormattedText.setModel(this._oSummaryModel, "summaryDialog");

                this._oSummaryDialog = new Dialog({
                    title: "AI Summary",
                    contentWidth: "32rem",
                    verticalScrolling: true,
                    content: [this._oSummaryFormattedText],
                    beginButton: new Button({
                        text: "Close",
                        press: () => this._oSummaryDialog.close()
                    })
                });

                this.getView().addDependent(this._oSummaryDialog);
            }

            this._oSummaryModel.setProperty("/html", sHtml);
            this._oSummaryDialog.setTitle(
                oData.OrderNumber ? `AI Summary – ${oData.OrderNumber}` : "AI Summary"
            );
            this._oSummaryDialog.open();
        }
    });
});