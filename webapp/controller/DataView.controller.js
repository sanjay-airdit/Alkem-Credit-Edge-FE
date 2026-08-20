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

            // --- Grid/card pagination setup ---
            this._iPageSize = 20; // fixed page size
            this._iJumpSize = 10; // pages skipped by << / >>
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

            // Pre-load grid data in the background so it's ready the moment
            // the user switches to the Grid view (instead of loading on click).
            this._preloadGridData();
        },

        /**
         * Kicks off the first grid page load as soon as the OData model is
         * available, without waiting for the user to click the Grid toggle.
         */
        _preloadGridData: function () {
            const oView = this.getView();
            const oModel = oView.getModel(); // default OData model

            if (oModel) {
                this._loadGridPage(1);
            } else {
                // Model not attached yet (e.g. still resolving from manifest) -
                // wait for it, then load once.
                oView.attachEventOnce("modelContextChange", () => {
                    if (this.getView().getModel() && !this._bGridLoaded) {
                        this._loadGridPage(1);
                    }
                });
            }
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
            // Keep grid view in sync with the same search term
            this._loadGridPage(1);
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
                // Data is generally already preloaded from onInit;
                // this only fires a load if that preload hasn't completed yet.
                if (!this._bGridLoaded) {
                    this._loadGridPage(1);
                }
            }
        },

        _getTodayDate: function () {
            const oDateFormat = sap.ui.core.format.DateFormat.getDateInstance({ pattern: "yyyy-MM-dd" });
            return oDateFormat.format(new Date());
        },

        _getGridEntityPath: function () {
            const sTodayDate = this._getTodayDate();
            return `/ZC_CE_OrdersOnHold(p_date=datetime'${sTodayDate}T00:00:00')/Set`;
        },

        _loadGridPage: function (iPage) {
            const oView = this.getView();
            const oModel = oView.getModel(); // main OData model
            const oOrdersModel = oView.getModel("ordersModel");
            const sPath = this._getGridEntityPath();
            const iSkip = (iPage - 1) * this._iPageSize;

            if (!oModel) {
                return; // model not ready yet; _preloadGridData will retry
            }

            const aFilters = [];
            const oSearchFilter = this._buildSearchFilter();
            if (oSearchFilter) {
                aFilters.push(oSearchFilter);
            }

            oOrdersModel.setProperty("/busy", true);
            oOrdersModel.setProperty("/noData", false);

            oModel.read(sPath, {
                urlParameters: {
                    "$top": this._iPageSize,
                    "$skip": iSkip,
                    "$inlinecount": "allpages"
                },
                filters: aFilters,
                success: (oData) => {
                    this._bGridLoaded = true;
                    const aResults = (oData && oData.results) || [];
                    const iTotalCount = oData && oData.__count ? parseInt(oData.__count, 10) : aResults.length;
                    const iTotalPages = Math.max(1, Math.ceil(iTotalCount / this._iPageSize));
                    // Clamp requested page in case totalPages shrank (e.g. after a search)
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

        /**
         * Builds the page-number list for the toolbar:
         *   << Previous  1 ... 3 4 5 ... 600  Next >>
         * - Always shows the first page (1)
         * - Always shows the last page
         * - Shows a window of (current-1, current, current+1)
         * - Inserts an "..." separator wherever there's a gap
         */
        _buildPageNumbers: function (iCurrent, iTotal) {
            const iBoundaryStart = 1; // always-visible pages at the start
            const iBoundaryEnd = 1;   // always-visible pages at the end
            const iSiblingCount = 1;  // pages around the current page

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

        /** "Previous" — go back exactly 1 page */
        onGridPrevPage: function () {
            const oOrdersModel = this.getView().getModel("ordersModel");
            const iCurrent = oOrdersModel.getProperty("/currentPage");
            if (iCurrent > 1) {
                this._loadGridPage(iCurrent - 1);
            }
        },

        /** "Next" — go forward exactly 1 page */
        onGridNextPage: function () {
            const oOrdersModel = this.getView().getModel("ordersModel");
            const iCurrent = oOrdersModel.getProperty("/currentPage");
            const iTotal = oOrdersModel.getProperty("/totalPages");
            if (iCurrent < iTotal) {
                this._loadGridPage(iCurrent + 1);
            }
        },

        /** "<<" — jump back 10 pages (clamped to page 1) */
        onGridJumpBack: function () {
            const oOrdersModel = this.getView().getModel("ordersModel");
            const iCurrent = oOrdersModel.getProperty("/currentPage");
            if (iCurrent > 1) {
                const iTarget = Math.max(1, iCurrent - this._iJumpSize);
                this._loadGridPage(iTarget);
            }
        },

        /** ">>" — jump forward 10 pages (clamped to last page) */
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
            const oCtx = oEvent.getSource().getBindingContext("ordersModel");
            const oOrder = oCtx && oCtx.getObject();
            /* call approve API using oOrder.OrderNumber, then this._loadGridPage(current page) to refresh */
        },
        onReject: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("ordersModel");
            const oOrder = oCtx && oCtx.getObject();
            /* call reject API */
        },
        onReset: function (oEvent) {
            const oCtx = oEvent.getSource().getBindingContext("ordersModel");
            const oOrder = oCtx && oCtx.getObject();
            /* call reset API */
        }
    });
});