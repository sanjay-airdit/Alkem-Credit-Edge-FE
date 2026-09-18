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
    "sap/m/MessageBox"
], function (Controller, JSONModel, Filter, FilterOperator, DateFormat, Fragment, Dialog, Button, FormattedText, formatter, MessageBox) {
    "use strict";
    return Controller.extend("creditedge.controller.DataView", {

        formatter: formatter,

        // Default filter period, reused by both List (SmartTable) and Grid views
        _oDefaultFilterDates: {
            fromDate: new Date(2023, 8, 1),  // 2023-09-01
            toDate: new Date(2023, 8, 30)    // 2023-09-30
        },

        onInit: function () {
            const oKpiModel = new JSONModel({
                totalOrders: 0,
                inHold: 0,
                approved: 0,
                highRiskOrders: 0,
                avgDelayScore: 0,
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
                orderNumber: ""
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

            // Set on the view (existing bindings in DataView.view.xml keep working)
            this.getView().setModel(oOrdersModel, "ordersModel");
            // ALSO set on the owner Component, so EntryPage's footer (outside this view)
            // can bind to the same live model instance.
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

        /**
         * Kicks off the first grid page load as soon as the OData model is
         * available, without waiting for the user to click the Grid toggle.
         */
        _preloadGridData: function () {
            const oModel = this.getOwnerComponent().getModel(); // default OData model

            if (oModel) {
                this._loadGridPage(1);
            } else {
                oView.attachEventOnce("modelContextChange", () => {
                    if (this.getView().getModel() && !this._bGridLoaded) {
                        this._loadGridPage(1);
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

        /**
         * Builds the OrderNumber free-text search filter (existing behavior),
         * OR-combined across the configured searchable fields.
         */
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


        _buildFilterBarFilters: function () {
            const oFilterModel = this.getView().getModel("filterModel");
            if (!oFilterModel) {
                return [];
            }

            const oData = oFilterModel.getData();
            const aFilters = [];

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

        /**
         * Combines the free-text search filter with the filter bar filters
         * into a single AND-ed filter, used by both the SmartTable rebind
         * and the Grid OData read.
         */
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
                orderNumber: ""
            });
            this.onFilterSearch();
        },

        onViewSwitchChange: function (oEvent) {
            const oItem = oEvent.getParameter("item");
            const sKey = oItem ? oItem.getKey() : oEvent.getSource().getSelectedKey();
            const oView = this.getView();
            const oListBox = oView.byId("listViewBox");
            const oGridBox = oView.byId("gridViewBox");

            // Tell EntryPage's footer whether Grid view is active
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
            let oModel = oView.getModel(); // main OData model
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
                "Grade"
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

                    const oKpiModel = this.getView().getModel("kpiModel");
                    if (oKpiModel) {
                        oKpiModel.setProperty("/totalOrders", iTotalCount);
                    }
                },
                error: (oError) => {
                    oOrdersModel.setProperty("/busy", false);
                    oOrdersModel.setProperty("/orders", []);
                    oOrdersModel.setProperty("/noData", true);
                    sap.m.MessageToast.show("Failed to load orders. Please try again.");
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

        // --- Navigation handlers -------------------------------------------------

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

        onApprove: function (oEvent) {
            const oOrder = this._getOrderFromEvent(oEvent);
            const sOrderNumber = oOrder?.OrderNumber;

            if (!sOrderNumber) {
                MessageBox.error("No order selected.");
                return;
            }

            const oModel = this.getView().getModel("ZUI_CE_APPR_MATRIX_SB");

            this.getView().setBusy(true);

            oModel.callFunction("/approve", {
                method: "POST",
                urlParameters: {
                    Vbeln: sOrderNumber
                },
                success: (oData, oResponse) => {
                    this.getView().setBusy(false);
                    MessageBox.success(`Order Number - ${sOrderNumber} Approved`);
                    oModel.refresh(true);
                },
                error: (oError) => {
                    this.getView().setBusy(false);
                    MessageBox.error("Failed to approve order " + sOrderNumber);
                }
            });
        },
        onReject: function (oEvent) {
            const oOrder = this._getOrderFromEvent(oEvent);
            const sOrderNumber = oOrder?.OrderNumber;

            if (!sOrderNumber) {
                MessageBox.error("No order selected.");
                return;
            }

            const oModel = this.getView().getModel("ZUI_CE_APPR_MATRIX_SB");

            this.getView().setBusy(true);

            oModel.callFunction("/reject", {
                method: "POST",
                urlParameters: {
                    Vbeln: sOrderNumber
                },
                success: (oData, oResponse) => {
                    this.getView().setBusy(false);
                    MessageBox.success(`Order Number - ${sOrderNumber} Rejected`);
                    oModel.refresh(true);
                },
                error: (oError) => {
                    this.getView().setBusy(false);
                    MessageBox.error(`Failed to Reject Order Number - ${sOrderNumber}`);
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

            this.getView().setBusy(true);

            oModel.callFunction("/get_log", {
                method: "POST",
                urlParameters: {
                    Vbeln: sOrderNumber
                },
                success: (oData, oResponse) => {
                    this.getView().setBusy(false);
                    const aResults = (oData && oData.results) || [];
                    this._openApprovalLogDialog(sOrderNumber, aResults);
                },
                error: (oError) => {
                    this.getView().setBusy(false);
                    MessageBox.error(`Failed to Fetch Logs Order Number - ${sOrderNumber}`);
                }
            });
        },

        /**
         * Opens (creating on first use) a fragment-based Dialog showing the
         * approval log for the given order, sorted chronologically.
         */
        _openApprovalLogDialog: function (sOrderNumber, aResults) {
            const fnShowDialog = (oDialog) => {
                if (!this._oLogModel) {
                    this._oLogModel = new JSONModel({ logs: [] });
                    oDialog.setModel(this._oLogModel, "logModel");
                }

                // Sort by ActionWhen ascending so the approval chain reads top-to-bottom
                const aSorted = [...aResults].sort((a, b) =>
                    new Date(a.ActionWhen) - new Date(b.ActionWhen)
                );

                this._oLogModel.setProperty("/logs", aSorted);
                oDialog.setTitle(sOrderNumber ? `Approval Log – ${sOrderNumber}` : "Approval Log");
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

        // --- AI summary parsing / display -----------------------------------------

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