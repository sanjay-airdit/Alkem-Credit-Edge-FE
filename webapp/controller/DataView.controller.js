sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/FormattedText",
    "creditedge/controller/formatter"
], function (Controller, JSONModel, Filter, FilterOperator, Dialog, Button, FormattedText, formatter) {
    "use strict";
    return Controller.extend("creditedge.controller.DataView", {

        formatter: formatter,

        onInit: function () {
            const oKpiModel = new JSONModel({
                totalOrders: 12523232,
                inHold: 124355,
                approved: 13342,
                highRiskOrders: 232442,
                avgDelayScore: 5.0,
                avgSopScore: 2.7
            });
            this.getView().setModel(oKpiModel, "kpiModel");
            this._sSearchQuery = "";

            // --- Grid/card pagination setup ---
            this._iPageSize = 20; // fixed page size
            this._iJumpSize = 9; // pages skipped by << / >>
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
        },

        // --- AI summary parsing / display -----------------------------------------

        /**
         * Converts the AISummaryText markdown-ish content into a small, safe
         * HTML subset that sap.m.FormattedText can render natively (no custom
         * CSS/styling involved - headings, bold text and bullet lists are all
         * rendered using the current UI5 theme).
         *
         * Handles the two shapes this field tends to arrive in:
         *   1) "### Section Heading" followed by "* **Label** is **value**" bullets
         *   2) A standalone "**Section Heading**" line (no leading #) used as
         *      a heading, followed by the same style of bullets
         *
         * Used as a binding formatter: formatter: '.formatSummaryHtml'
         *
         * @param {string} sText raw AISummaryText value
         * @returns {string} sanitized HTML string for FormattedText's htmlText
         */
        formatSummaryHtml: function (sText) {
            if (!sText) {
                return "<p><em>No summary available.</em></p>";
            }

            // 1) Escape the raw text first so nothing in the source can be
            //    interpreted as real markup - only tags we add ourselves below
            //    end up in the output.
            const sEscaped = String(sText)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;");

            // 2) Normalise line breaks and split into lines
            const aLines = sEscaped.replace(/\r\n/g, "\n").split("\n");

            let sHtml = "";
            let bInList = false;

            const closeList = () => {
                if (bInList) {
                    sHtml += "</ul>";
                    bInList = false;
                }
            };

            // Inline **bold** -> <strong>bold</strong>
            const applyInline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

            aLines.forEach((sRawLine) => {
                const sLine = sRawLine.trim();

                if (!sLine) {
                    closeList();
                    return;
                }

                // ATX-style headers: ### Heading
                const oHeaderMatch = sLine.match(/^(#{1,6})\s+(.*)$/);
                if (oHeaderMatch) {
                    closeList();
                    const iLevel = Math.min(oHeaderMatch[1].length, 6);
                    const sContent = applyInline(oHeaderMatch[2]);
                    sHtml += `<h5>${sContent}</h5>`;
                    return;
                }

                // Bullet lines: "* text" or "- text"
                const oBulletMatch = sLine.match(/^[*-]\s+(.*)$/);
                if (oBulletMatch) {
                    if (!bInList) {
                        sHtml += "<ul>";
                        bInList = true;
                    }
                    sHtml += `<li>${applyInline(oBulletMatch[1])}</li>`;
                    return;
                }

                // A line that is ONLY "**Bold text**" (optionally with a
                // trailing colon) is treated as a sub-heading, since the AI
                // output sometimes skips the ### prefix entirely.
                const oStandaloneBold = sLine.match(/^\*\*(.+?)\*\*:?\s*$/);
                if (oStandaloneBold) {
                    closeList();
                    sHtml += `<h3>${oStandaloneBold[1]}</h3>`;
                    return;
                }

                // Regular paragraph text
                closeList();
                sHtml += `<p>${applyInline(sLine)}</p>`;
            });

            closeList();
            return sHtml;
        },

        /**
         * Opens a Dialog showing the fully parsed AI summary for the row/card
         * that was pressed. Works from both the list Table (default model)
         * and the grid Cards (named "ordersModel"), and from either a Link
         * press or a Button press.
         */
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