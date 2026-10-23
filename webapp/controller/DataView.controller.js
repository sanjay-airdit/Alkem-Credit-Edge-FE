sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/type/String",
    "sap/ui/core/format/DateFormat",
    "sap/ui/core/Fragment",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/FormattedText",
    "sap/m/MessageBox",
    "sap/m/Token",
    "sap/m/Input",
    "sap/m/Label",
    "sap/m/Text",
    "sap/m/SearchField",
    "sap/m/ColumnListItem",
    "sap/m/Column",
    "sap/ui/table/Column",
    "sap/ui/comp/valuehelpdialog/ValueHelpDialog",
    "sap/ui/comp/filterbar/FilterBar",
    "sap/ui/comp/filterbar/FilterGroupItem",
    "creditedge/controller/formatter",
    "sap/ui/core/BusyIndicator",
    "sap/ui/model/type/Float",
    "sap/m/p13n/Popup",
    "sap/m/p13n/SelectionPanel",
    "sap/m/Popover",
    "sap/m/HBox",
    "sap/ui/comp/state/UIState"
], function (Controller, JSONModel, Filter, FilterOperator, TypeString, DateFormat, Fragment, Dialog, Button,
    FormattedText, MessageBox, Token, Input, Label, Text, SearchField, ColumnListItem, MColumn, UIColumn,
    ValueHelpDialog, FilterBar, FilterGroupItem, formatter, BusyIndicator, TypeFloat,
    P13nPopup, SelectionPanel, Popover, HBox, UIState) {
    "use strict";
    return Controller.extend("creditedge.controller.DataView", {

        formatter: formatter,

        // Name of the OData model (manifest.json) for ZC_CE_ORDER_KPI_QUERY_CDS
        _sKpiModelName: "ZC_CE_ORDER_KPI_QUERY_CDS",

        _oDefaultCompanyCode: {
            key: "1000",
            text: "ALKEM LABORATORIES LTD. (1000)"
        },

        // _oDefaultCompanyCode: {
        //     key: "3600",
        //     text: "Alkem Wellness Limited (3600)"
        // },

        // Becomes true once 'CanChangeCompanyCode' has been read and applied.
        // Until then the SmartTable bind is held back (see onBeforeRebindTable).
        _bCompanyCodeResolved: false,

        // Whether the user may change the Company Code filter (false until resolved)
        _bCanChangeCompanyCode: false,

        // Key under which the user's filter visibility is stored in the browser
        _sFilterConfigStorageKey: "creditedge.dataview.filterVisibility",

        // Key under which the user's SmartTable layout (columns / order / sort / group) is stored
        _sTableConfigStorageKey: "creditedge.dataview.tableLayout",

        // Layout as delivered by the view (captured before the saved one is applied) -> used by "Reset Layout"
        _oDefaultTableLayout: null,

        // True while a saved layout is being applied (prevents saving it back)
        _bRestoringTableLayout: false,

        // Filters that can be configured. locked: true -> always visible (cannot be hidden)
        // keys must match the keys used in the view (filterConfigModel>/visible/<key>)
        _aFilterDefs: [
            { key: "fromDate", label: "From Date", locked: true },
            { key: "toDate", label: "To Date", locked: true },
            { key: "companyCode", label: "Company Code" },
            { key: "orderNumber", label: "Order Number" },
            { key: "customer", label: "Customer" },
            { key: "division", label: "Division" },
            { key: "businessArea", label: "Business Area" },
            { key: "utilization", label: "Utilization %" },
            { key: "outstanding", label: "Outstanding Amount" },
            { key: "recommendation", label: "Recommendation" }
        ],

        // Visible by default
        _mDefaultVisibleFilters: {
            fromDate: true,
            toDate: true,
            companyCode: true,
            orderNumber: true,
            customer: true,
            division: false,
            businessArea: false,
            utilization: false,
            outstanding: false,
            recommendation: false
        },

        _getDefaultFilterDates: function () {
            const oToday = new Date();
            return {
                fromDate: new Date(oToday.getFullYear(), oToday.getMonth(), 1),
                toDate: new Date(oToday.getFullYear(), oToday.getMonth(), oToday.getDate())
            };
        },

        // Status tab keys — must match the values coming from the backend field
        // used in _buildFilterBarFilters (currently status).
        _sDefaultStatusTab: "HOLD",

        onInit: function () {
            const oKpiModel = new JSONModel({
                TotalOrders: 0,
                InHold: 0,
                ApprovedOrders: 0,
                RejectedOrders: 0,
                HighRiskOrders: 0,
                DelayRanges: [
                    { label: "1-10", count: 0 },
                    { label: "11-20", count: 0 },
                    { label: "21-31", count: 0 }
                ],
                avgSopScore: 0
            });
            this.getView().setModel(oKpiModel, "kpiModel");
            this._sSearchQuery = "";
            this._iKpiRequestId = 0;

            // --- Selection model (drives enabled state of the toolbar Approve / Reject buttons) ---
            this.getView().setModel(new JSONModel({ count: 0 }), "selectionModel");

            // --- Filter bar model (shared by List + Grid views) ---
            // NOTE: Company Code / Order Number / Customer / Division / Business Area /
            // Utilization % / Outstanding Amount are MultiInputs (tokens),
            // so they are no longer stored in this model.
            // recommendation is an array of selected keys (Approve / Hold / Reject)
            const oDefaultDates = this._getDefaultFilterDates();
            const oFilterModel = new JSONModel({
                fromDate: oDefaultDates.fromDate,
                toDate: oDefaultDates.toDate,
                recommendation: [],
                statusTab: this._sDefaultStatusTab
            });
            this.getView().setModel(oFilterModel, "filterModel");

            // --- Filter visibility (Settings button) ---
            this.getView().setModel(
                new JSONModel({ visible: this._loadFilterVisibility() }),
                "filterConfigModel"
            );

            // --- Value help configuration ---
            // rangeOnly: true  -> no value help entity; only the "Define Conditions" tab is offered
            // numeric:   true  -> typed text must be a number
            this._mVHConfig = {
                companyCode: {
                    inputId: "idCompanyCodeFilter",
                    filterPath: "CompanyCode",
                    title: "Company Code",
                    entitySet: "/I_CompanyCode",
                    key: "CompanyCode",
                    descriptionKey: "CompanyCodeName",
                    maxLength: 4,
                    columns: [
                        { field: "CompanyCode", label: "Company Code" },
                        { field: "CompanyCodeName", label: "Company Name" }
                    ],
                    searchFields: ["CompanyCode", "CompanyCodeName"]
                },
                orderNumber: {
                    inputId: "idOrderNumberFilter",
                    filterPath: "OrderNumber",
                    title: "Order Number",
                    entitySet: "/I_SalesDocument",
                    key: "SalesDocument",
                    descriptionKey: null,
                    maxLength: 10,
                    columns: [
                        { field: "SalesDocument", label: "Order Number" },
                        { field: "SalesDocumentType", label: "Doc. Type" },
                        { field: "SoldToParty", label: "Sold-to Party" }
                    ],
                    searchFields: ["SalesDocument", "SoldToParty"]
                },
                customer: {
                    inputId: "idCustomerFilter",
                    filterPath: "Customer",
                    title: "Customer",
                    entitySet: "/I_Customer",
                    key: "Customer",
                    descriptionKey: "CustomerName",
                    maxLength: 10,
                    columns: [
                        { field: "Customer", label: "Customer" },
                        { field: "CustomerName", label: "Customer Name" }
                    ],
                    searchFields: ["Customer", "CustomerName"]
                },
                division: {
                    inputId: "idDivisionFilter",
                    filterPath: "Division",
                    title: "Division",
                    entitySet: "/I_Division",
                    key: "Division",
                    descriptionKey: "Division_Text",
                    maxLength: 2,
                    columns: [
                        { field: "Division", label: "Division" },
                        { field: "Division_Text", label: "Description" }
                    ],
                    searchFields: ["Division", "Division_Text"]
                },
                businessArea: {
                    inputId: "idBusinessAreaFilter",
                    filterPath: "BusinessArea",
                    title: "Business Area",
                    entitySet: "/I_BusinessArea",
                    key: "BusinessArea",
                    descriptionKey: "BusinessArea_Text",
                    maxLength: 4,
                    columns: [
                        { field: "BusinessArea", label: "Business Area" },
                        { field: "BusinessArea_Text", label: "Description" }
                    ],
                    searchFields: ["BusinessArea", "BusinessArea_Text"]
                },
                utilization: {
                    inputId: "idUtilizationFilter",
                    filterPath: "AIUtilizationPercentage",
                    title: "Utilization %",
                    key: "AIUtilizationPercentage",
                    numeric: true,
                    rangeOnly: true
                },
                outstanding: {
                    inputId: "idOutstandingFilter",
                    filterPath: "OutstandingAmount",
                    title: "Outstanding Amount",
                    key: "OutstandingAmount",
                    numeric: true,
                    rangeOnly: true
                }
            };

            // Validators: turn a selected suggestion / typed text into a Token
            Object.keys(this._mVHConfig).forEach((sName) => {
                const cfg = this._mVHConfig[sName];
                const oInput = this.byId(cfg.inputId);
                if (oInput) {
                    oInput.addValidator(this._createValidator(cfg));
                }
            });

            // Company Code is locked + pre-filled until 'CanChangeCompanyCode' is known
            this._applyCompanyCodeDefault(false);

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

            const oSmartTable = this.byId("idSmartTable");
            const customizeConfig = {
                autoColumnWidth: {
                    'Customer': { min: 2, max: 15, gap: 1, truncateLabel: false },
                    'CreditEsposure': { min: 2, max: 8, gap: 1, truncateLabel: false },
                    'Division': { min: 2, max: 4, gap: 1, truncateLabel: false },
                    'AIUtilizationPercentage': { min: 2, max: 5, gap: 1, truncateLabel: false },
                    'CurrentOrderValue': { min: 2, max: 8, gap: 1, truncateLabel: false },
                }
            };
            oSmartTable.setCustomizeConfig(customizeConfig);
        },

        _applyCompanyCodeDefault: function (bEditable) {
            const oInput = this.byId(this._mVHConfig.companyCode.inputId);
            if (!oInput) {
                return;
            }

            const sFullText = this._oDefaultCompanyCode.text;

            oInput.removeAllTokens();
            oInput.setValue("");

            // The token carries its own tooltip (always, enabled or disabled)
            oInput.addToken(new Token({
                key: this._oDefaultCompanyCode.key,
                text: sFullText,
                tooltip: sFullText
            }));

            // editable=false also hides the value help icon and the token delete icon
            oInput.setEditable(!!bEditable);
            oInput.setShowValueHelp(!!bEditable);

            // When the filter is locked, the suggestion popup must not open either
            // (startSuggestion="0" would otherwise show it on focus / click)
            oInput.setShowSuggestion(!!bEditable);

            // Tooltip on the input itself - always shown, whether enabled or disabled
            oInput.setTooltip(sFullText);

            // A non-editable MultiInput can render its inner elements without the title
            // attribute, so copy the tooltip onto the rendered DOM as well
            this._applyCompanyCodeTooltipToDom(oInput, sFullText);

            // Click on the locked field -> popover with the full text (+ copy icon)
            if (!this._oCompanyCodeClickDelegate) {
                this._oCompanyCodeClickDelegate = {
                    ontap: () => {
                        if (!this._bCanChangeCompanyCode) {
                            this._openCompanyCodePopover(oInput);
                        }
                    }
                };
                oInput.addEventDelegate(this._oCompanyCodeClickDelegate);
            }
        },

        // Popover that shows the complete default Company Code text when the locked
        // (non-editable) field is clicked
        _openCompanyCodePopover: function (oInput) {
            const sText = this._oDefaultCompanyCode.text;

            if (!this._oCompanyCodePopover) {
                this._oCompanyCodePopover = new Popover({
                    showHeader: false,
                    placement: "Bottom",
                    content: [
                        new HBox({
                            alignItems: "Center",
                            justifyContent: "SpaceBetween",
                            items: [
                                new Text({ text: sText }).addStyleClass("sapUiTinyMargin"),
                            ]
                        })
                    ]
                });
                this.getView().addDependent(this._oCompanyCodePopover);
            }

            if (this._oCompanyCodePopover.isOpen()) {
                this._oCompanyCodePopover.close();
            } else {
                this._oCompanyCodePopover.openBy(oInput);
            }
        },

        // Puts the tooltip on the rendered DOM of the Company Code MultiInput (root, inner
        // input, tokenizer and tokens), now and after every re-render
        _applyCompanyCodeTooltipToDom: function (oInput, sText) {
            const fnSet = () => {
                const oDom = oInput.getDomRef();
                if (!oDom) {
                    return;
                }
                oDom.setAttribute("title", sText);
                oDom.querySelectorAll(".sapMInputBaseInner, .sapMTokenizer, .sapMToken")
                    .forEach((oEl) => oEl.setAttribute("title", sText));
            };

            if (!this._oCompanyCodeTooltipDelegate) {
                this._oCompanyCodeTooltipDelegate = {
                    onAfterRendering: () => {
                        fnSet();
                    }
                };
                oInput.addEventDelegate(this._oCompanyCodeTooltipDelegate);
            }

            // keep the latest text for the delegate
            this._sCompanyCodeTooltipText = sText;
            this._oCompanyCodeTooltipDelegate.onAfterRendering = () => {
                fnSet();
            };

            fnSet();
        },

        _loadCompanyCodePermission: function () {
            const oView = this.getView();
            const oModel = oView.getModel(this._sKpiModelName)
                || this.getOwnerComponent().getModel(this._sKpiModelName);

            // KPI service not available -> safe fallback: default value, filter locked
            if (!oModel) {
                this._onCompanyCodePermissionResolved(false);
                return;
            }

            oModel.read(this._getKpiEntityPath(), {
                urlParameters: {
                    "$select": "CanChangeCompanyCode"
                },
                success: (oData) => {
                    const aResults = (oData && oData.results) || [];

                    // 'X' -> can change. Empty -> cannot change.
                    // If several rows come back, a single 'X' enables the filter.
                    const bCanChange = aResults.some((oRow) =>
                        String((oRow && oRow.CanChangeCompanyCode) || "").trim().toUpperCase() === "X"
                    );

                    this._onCompanyCodePermissionResolved(bCanChange);
                },
                error: () => {
                    // Safe fallback: default value, filter locked
                    this._onCompanyCodePermissionResolved(false);
                }
            });
        },

        _onCompanyCodePermissionResolved: function (bCanChange) {
            this._bCanChangeCompanyCode = !!bCanChange;
            this._bCompanyCodeResolved = true;

            this._applyCompanyCodeDefault(this._bCanChangeCompanyCode);

            // First real data load (now including the Company Code filter)
            const oSmartTable = this.byId("idSmartTable");
            if (oSmartTable) {
                oSmartTable.rebindTable(true);
            }
            this._loadGridPage(1);
            this._loadKpiData();
        },

        onTableSelectionChange: function () {
            this._updateSelectionState();
        },

        // Rebind / growing / refresh can change the selection, so re-sync the button state
        onTableUpdateFinished: function () {
            this._updateSelectionState();
        },

        _updateSelectionState: function () {
            const oTable = this.byId("idTableAccount");
            const iCount = oTable ? oTable.getSelectedItems().length : 0;
            const oSelectionModel = this.getView().getModel("selectionModel");
            if (oSelectionModel) {
                oSelectionModel.setProperty("/count", iCount);
            }
        },

        _clearTableSelection: function () {
            const oTable = this.byId("idTableAccount");
            if (oTable) {
                oTable.removeSelections(true);
            }
            this._updateSelectionState();
        },

        _getSelectedOrders: function () {
            const oTable = this.byId("idTableAccount");
            if (!oTable) {
                return [];
            }
            return oTable.getSelectedItems()
                .map((oItem) => oItem.getBindingContext() && oItem.getBindingContext().getObject())
                .filter((oOrder) => oOrder && oOrder.OrderNumber);
        },


        _createValidator: function (cfg) {
            return function (oArgs) {
                // Selected from suggestion list
                if (oArgs.suggestionObject) {
                    const oObject = oArgs.suggestionObject.getBindingContext().getObject();
                    const sKey = oObject[cfg.key];
                    const sDesc = cfg.descriptionKey ? oObject[cfg.descriptionKey] : "";
                    return new Token({
                        key: sKey,
                        text: sDesc ? sDesc + " (" + sKey + ")" : sKey
                    });
                }
                // Free text + Enter
                const sText = (oArgs.text || "").trim();
                if (!sText) {
                    return null;
                }
                // Numeric fields: only accept numbers
                if (cfg.numeric) {
                    const sNum = sText.replace(/,/g, "");
                    if (isNaN(Number(sNum))) {
                        return null;
                    }
                    return new Token({ key: sNum, text: sNum });
                }
                return new Token({ key: sText, text: sText });
            };
        },

        // ---- Value help request handlers (one per filter) ----
        onCompanyCodeValueHelp: function () { this._openValueHelp("companyCode"); },
        onOrderNumberValueHelp: function () { this._openValueHelp("orderNumber"); },
        onCustomerValueHelp: function () { this._openValueHelp("customer"); },
        onDivisionValueHelp: function () { this._openValueHelp("division"); },
        onBusinessAreaValueHelp: function () { this._openValueHelp("businessArea"); },
        onUtilizationValueHelp: function () { this._openValueHelp("utilization"); },
        onOutstandingValueHelp: function () { this._openValueHelp("outstanding"); },

        // ---- Suggest handlers (one per filter) ----
        onCompanyCodeSuggest: function (oEvent) { this._onSuggest(oEvent, "companyCode"); },
        onOrderNumberSuggest: function (oEvent) { this._onSuggest(oEvent, "orderNumber"); },
        onCustomerSuggest: function (oEvent) { this._onSuggest(oEvent, "customer"); },
        onDivisionSuggest: function (oEvent) { this._onSuggest(oEvent, "division"); },
        onBusinessAreaSuggest: function (oEvent) { this._onSuggest(oEvent, "businessArea"); },

        _onSuggest: function (oEvent, sName) {
            // Company Code is locked -> no suggestions at all
            if (sName === "companyCode" && !this._bCanChangeCompanyCode) {
                return;
            }

            const cfg = this._mVHConfig[sName];
            const sValue = oEvent.getParameter("suggestValue");
            const oBinding = oEvent.getSource().getBinding("suggestionRows");
            if (!oBinding) {
                return;
            }

            let aFilters = [];
            if (sValue) {
                aFilters = [new Filter({
                    filters: cfg.searchFields.map((sField) => new Filter({
                        path: sField,
                        operator: FilterOperator.Contains,
                        value1: sValue
                    })),
                    and: false
                })];
            }
            oBinding.filter(aFilters);
        },

        _openValueHelp: function (sName) {
            const cfg = this._mVHConfig[sName];
            const oInput = this.byId(cfg.inputId);

            // Company Code value help is not allowed when the user cannot change it
            if (sName === "companyCode" && !this._bCanChangeCompanyCode) {
                return;
            }

            // Numeric fields without a value help entity -> "Define Conditions" only
            if (cfg.rangeOnly) {
                this._openRangeOnlyValueHelp(cfg, oInput);
                return;
            }

            const oModel = this.getView().getModel() || this.getOwnerComponent().getModel();
            const oBasicSearch = new SearchField();
            let oDialog;

            // Filter bar inside the dialog
            const oFilterBar = new FilterBar({
                advancedMode: true,
                isRunningInValueHelpDialog: true,
                filterGroupItems: cfg.columns.map((c) => new FilterGroupItem({
                    groupName: "__$INTERNAL$",
                    name: c.field,
                    label: c.label,
                    visibleInFilterBar: true,
                    control: new Input({ name: c.field })
                })),
                search: (oEvent) => this._onValueHelpSearch(oEvent, cfg, oDialog, oBasicSearch)
            });

            const mSettings = {
                title: cfg.title,
                supportRanges: true,
                key: cfg.key,
                filterBar: oFilterBar,
                ok: (oEvent) => {
                    oInput.setTokens(oEvent.getParameter("tokens"));
                    oDialog.close();
                },
                cancel: () => oDialog.close(),
                afterClose: () => oDialog.destroy()
            };
            if (cfg.descriptionKey) {
                mSettings.descriptionKey = cfg.descriptionKey;
            }
            oDialog = new ValueHelpDialog(mSettings);
            this.getView().addDependent(oDialog);

            // "Define Conditions" tab
            oDialog.setRangeKeyFields([{
                label: cfg.title,
                key: cfg.key,
                type: "string",
                typeInstance: new TypeString({}, { maxLength: cfg.maxLength })
            }]);

            // Basic search
            oFilterBar.setFilterBarExpanded(false);
            oFilterBar.setBasicSearch(oBasicSearch);
            oBasicSearch.attachSearch(() => oFilterBar.search());

            // Table
            oDialog.getTableAsync().then((oTable) => {
                oTable.setModel(oModel);

                // Desktop / tablet: sap.ui.table.Table
                if (oTable.bindRows) {
                    oTable.bindAggregation("rows", {
                        path: cfg.entitySet,
                        events: {
                            dataReceived: () => oDialog.update()
                        }
                    });
                    cfg.columns.forEach((c) => {
                        const oColumn = new UIColumn({
                            label: new Label({ text: c.label }),
                            template: new Text({ wrapping: false, text: "{" + c.field + "}" })
                        });
                        oColumn.data({ fieldName: c.field });
                        oTable.addColumn(oColumn);
                    });
                }

                // Mobile: sap.m.Table
                if (oTable.bindItems) {
                    oTable.bindAggregation("items", {
                        path: cfg.entitySet,
                        template: new ColumnListItem({
                            cells: cfg.columns.map((c) => new Label({ text: "{" + c.field + "}" }))
                        }),
                        events: {
                            dataReceived: () => oDialog.update()
                        }
                    });
                    cfg.columns.forEach((c) => {
                        oTable.addColumn(new MColumn({ header: new Label({ text: c.label }) }));
                    });
                }

                oDialog.update();
            });

            oDialog.setTokens(oInput.getTokens());
            oDialog.open();
        },

        // Value help for numeric fields without a value-help entity: "Define Conditions" only
        _openRangeOnlyValueHelp: function (cfg, oInput) {
            const oDialog = new ValueHelpDialog({
                title: cfg.title,
                supportRanges: true,
                supportRangesOnly: true,
                key: cfg.key,
                ok: (oEvent) => {
                    oInput.setTokens(oEvent.getParameter("tokens"));
                    oDialog.close();
                },
                cancel: () => oDialog.close(),
                afterClose: () => oDialog.destroy()
            });
            this.getView().addDependent(oDialog);

            oDialog.setRangeKeyFields([{
                label: cfg.title,
                key: cfg.key,
                type: "numeric",
                typeInstance: new TypeFloat({ groupingEnabled: false })
            }]);

            // "Empty" makes no sense for a numeric measure
            oDialog.setIncludeRangeOperations(["EQ", "BT", "LT", "LE", "GT", "GE"], "numeric");

            oDialog.setTokens(oInput.getTokens());
            oDialog.open();
        },

        _onValueHelpSearch: function (oEvent, cfg, oDialog, oBasicSearch) {
            const sQuery = oBasicSearch.getValue();
            const aSelectionSet = oEvent.getParameter("selectionSet") || [];

            const aFilters = aSelectionSet.reduce((aResult, oControl) => {
                if (oControl.getValue && oControl.getValue()) {
                    aResult.push(new Filter({
                        path: oControl.getName(),
                        operator: FilterOperator.Contains,
                        value1: oControl.getValue()
                    }));
                }
                return aResult;
            }, []);

            if (sQuery) {
                aFilters.push(new Filter({
                    filters: cfg.columns.map((c) => new Filter({
                        path: c.field,
                        operator: FilterOperator.Contains,
                        value1: sQuery
                    })),
                    and: false
                }));
            }

            const oFilter = aFilters.length
                ? new Filter({ filters: aFilters, and: true })
                : null;

            oDialog.getTableAsync().then((oTable) => {
                const oBinding = oTable.getBinding("rows") || oTable.getBinding("items");
                if (oBinding) {
                    oBinding.filter(oFilter);
                }
                // must be called after the binding update
                oDialog.update();
            });
        },

        // Converts the tokens of one MultiInput into one OData filter
        _buildTokenFilter: function (cfg) {
            const oInput = this.byId(cfg.inputId);
            if (!oInput) {
                return null;
            }

            const aInclude = [];
            const aExclude = [];

            oInput.getTokens().forEach((oToken) => {
                const oFilter = this._tokenToFilter(oToken, cfg.filterPath);
                if (!oFilter) {
                    return;
                }
                const oRange = oToken.data("range");
                if (oRange && oRange.exclude) {
                    aExclude.push(oFilter);
                } else {
                    aInclude.push(oFilter);
                }
            });

            const aAll = [];
            if (aInclude.length) {
                aAll.push(aInclude.length === 1 ? aInclude[0] : new Filter({ filters: aInclude, and: false }));
            }
            if (aExclude.length) {
                aAll.push(aExclude.length === 1 ? aExclude[0] : new Filter({ filters: aExclude, and: true }));
            }

            if (!aAll.length) {
                return null;
            }
            return aAll.length === 1 ? aAll[0] : new Filter({ filters: aAll, and: true });
        },

        _tokenToFilter: function (oToken, sPath) {
            const oRange = oToken.data("range");

            // Simple token (selected value / typed value)
            if (!oRange) {
                const sKey = oToken.getKey();
                return sKey ? new Filter(sPath, FilterOperator.EQ, sKey) : null;
            }

            // Range / condition token from "Define Conditions" tab
            const bExclude = !!oRange.exclude;
            const sOp = oRange.operation;
            const v1 = oRange.value1;
            const v2 = oRange.value2;

            const mInclude = {
                EQ: FilterOperator.EQ,
                Contains: FilterOperator.Contains,
                StartsWith: FilterOperator.StartsWith,
                EndsWith: FilterOperator.EndsWith,
                GT: FilterOperator.GT,
                GE: FilterOperator.GE,
                LT: FilterOperator.LT,
                LE: FilterOperator.LE
            };
            const mExclude = {
                EQ: FilterOperator.NE,
                Contains: FilterOperator.NotContains,
                StartsWith: FilterOperator.NotStartsWith,
                EndsWith: FilterOperator.NotEndsWith,
                GT: FilterOperator.LE,
                GE: FilterOperator.LT,
                LT: FilterOperator.GE,
                LE: FilterOperator.GT
            };

            if (sOp === "BT") {
                return new Filter(sPath, bExclude ? FilterOperator.NB : FilterOperator.BT, v1, v2);
            }
            if (sOp === "Empty") {
                return new Filter(sPath, bExclude ? FilterOperator.NE : FilterOperator.EQ, "");
            }

            const sFilterOp = (bExclude ? mExclude : mInclude)[sOp];
            return sFilterOp ? new Filter(sPath, sFilterOp, v1) : null;
        },

        // Text typed into a MultiInput but not confirmed with Enter -> becomes a token
        _commitPendingText: function () {
            Object.keys(this._mVHConfig).forEach((sName) => {
                const cfg = this._mVHConfig[sName];
                const oInput = this.byId(cfg.inputId);

                // Locked inputs (Company Code when it cannot be changed) are never modified
                if (!oInput || !oInput.getEditable()) {
                    return;
                }

                const sText = (oInput.getValue() || "").trim();
                if (sText) {
                    if (!cfg.numeric) {
                        oInput.addToken(new Token({ key: sText, text: sText }));
                    } else {
                        // Numeric fields: ignore text that is not a number
                        const sNum = sText.replace(/,/g, "");
                        if (!isNaN(Number(sNum))) {
                            oInput.addToken(new Token({ key: sNum, text: sNum }));
                        }
                    }
                    oInput.setValue("");
                }
            });
        },


        _preloadGridData: function () {
            const oModel = this.getOwnerComponent().getModel();

            if (oModel) {
                // Reads CanChangeCompanyCode first; grid / KPI / list load afterwards
                this._loadCompanyCodePermission();
            } else {
                const oView = this.getView();
                oView.attachEventOnce("modelContextChange", () => {
                    if (this.getView().getModel() && !this._bCompanyCodeResolved) {
                        this._loadCompanyCodePermission();
                    }
                });
            }
        },

        _getFormattedFilterDates: function () {
            const oFilterModel = this.getView().getModel("filterModel");
            const oDateFormat = DateFormat.getDateInstance({ pattern: "yyyy-MM-dd" });
            const oDefaultDates = this._getDefaultFilterDates();

            const oFromDate = (oFilterModel && oFilterModel.getProperty("/fromDate")) || oDefaultDates.fromDate;
            const oToDate = (oFilterModel && oFilterModel.getProperty("/toDate")) || oDefaultDates.toDate;

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
                "OrderNumber"
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

        // bExcludeStatusTab: true -> the status tab (On Hold / Approved / Rejected) is NOT
        // added to the filters. Used for the KPI call, which must always cover all statuses.
        _buildFilterBarFilters: function (bExcludeStatusTab) {
            const oFilterModel = this.getView().getModel("filterModel");
            if (!oFilterModel) {
                return [];
            }

            const oData = oFilterModel.getData();
            const aFilters = [];

            // Status tab filter (On Hold / Approved / Rejected) - list + grid only
            if (!bExcludeStatusTab && oData.statusTab) {
                aFilters.push(new Filter({
                    path: "status",
                    operator: FilterOperator.EQ,
                    value1: oData.statusTab
                }));
            }

            // Recommendation (multi-select) -> OR between the selected values
            if (Array.isArray(oData.recommendation) && oData.recommendation.length) {
                const aRecFilters = oData.recommendation.map((sKey) => new Filter({
                    path: "AISummaryVerdict",
                    operator: FilterOperator.Contains,
                    value1: sKey
                }));

                aFilters.push(
                    aRecFilters.length === 1
                        ? aRecFilters[0]
                        : new Filter({ filters: aRecFilters, and: false })
                );
            }

            // Value-help based filters (Company Code, Order Number, Customer, Division,
            // Business Area, Utilization %, Outstanding Amount)
            Object.keys(this._mVHConfig).forEach((sName) => {
                const oFilter = this._buildTokenFilter(this._mVHConfig[sName]);
                if (oFilter) {
                    aFilters.push(oFilter);
                }
            });

            return aFilters;
        },

        // bExcludeStatusTab: true -> same filters, but without the status tab filter (KPI)
        _buildODataFilters: function (bExcludeStatusTab) {
            const aAndFilters = [];

            const oSearchFilter = this._buildSearchFilter();
            if (oSearchFilter) {
                aAndFilters.push(oSearchFilter);
            }

            aAndFilters.push(...this._buildFilterBarFilters(bExcludeStatusTab));

            if (aAndFilters.length === 0) {
                return null;
            }

            return new Filter({
                filters: aAndFilters,
                and: true
            });
        },

        onBeforeRebindTable: function (oEvent) {
            if (!this._bCompanyCodeResolved) {
                oEvent.getParameter("bindingParams").preventTableBind = true;
                return;
            }

            const oSmartTable = oEvent.getSource();
            const mBindingParams = oEvent.getParameter("bindingParams");
            const oDates = this._getFormattedFilterDates();

            oSmartTable.setTableBindingPath(
                `/ZC_CE_OrdersOnHold(p_from_date=datetime'${oDates.from}T00:00:00',p_date=datetime'${oDates.to}T00:00:00')/Set`
            );

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
            this._clearTableSelection();

            const oSmartTable = this.getView().byId("idSmartTable");
            if (oSmartTable) {
                oSmartTable.rebindTable(true);
            }
            this._loadGridPage(1);
            this._loadKpiData();
        },

        onFilterSearch: function () {
            this._commitPendingText();
            this._clearTableSelection();

            const oSmartTable = this.byId("idSmartTable");
            if (oSmartTable) {
                oSmartTable.rebindTable(true);
            }
            this._loadGridPage(1);
            this._loadKpiData();
        },

        onFilterClear: function () {
            const oFilterModel = this.getView().getModel("filterModel");
            const oDefaultDates = this._getDefaultFilterDates();
            oFilterModel.setData({
                fromDate: oDefaultDates.fromDate,
                toDate: oDefaultDates.toDate,
                recommendation: [],
                statusTab: oFilterModel.getProperty("/statusTab") || this._sDefaultStatusTab // keep current tab on clear
            });

            // Clear the value-help MultiInputs (Company Code is reset to its default below)
            Object.keys(this._mVHConfig).forEach((sName) => {
                if (sName === "companyCode") {
                    return;
                }
                const oInput = this.byId(this._mVHConfig[sName].inputId);
                if (oInput) {
                    oInput.removeAllTokens();
                    oInput.setValue("");
                }
            });

            // Company Code -> back to the default value, editable state unchanged
            this._applyCompanyCodeDefault(this._bCanChangeCompanyCode);

            this.onFilterSearch();
        },

        /* =========================================================== */
        /* FILTER SETTINGS (choose which filters are visible)          */
        /* Uses the standard p13n popup (sap.m.p13n.Popup +            */
        /* SelectionPanel) -> same look as the "Adapt Filters" dialog  */
        /* =========================================================== */

        // Saved visibility merged with the defaults; locked filters are always visible
        _loadFilterVisibility: function () {
            const mVisible = Object.assign({}, this._mDefaultVisibleFilters);

            try {
                const sStored = window.localStorage.getItem(this._sFilterConfigStorageKey);
                if (sStored) {
                    const mStored = JSON.parse(sStored);
                    Object.keys(mVisible).forEach((sKey) => {
                        if (typeof mStored[sKey] === "boolean") {
                            mVisible[sKey] = mStored[sKey];
                        }
                    });
                }
            } catch (e) {
                // storage not available / corrupt -> use defaults
            }

            this._aFilterDefs.forEach((oDef) => {
                if (oDef.locked) {
                    mVisible[oDef.key] = true;
                }
            });
            return mVisible;
        },

        _saveFilterVisibility: function (mVisible) {
            try {
                window.localStorage.setItem(this._sFilterConfigStorageKey, JSON.stringify(mVisible));
            } catch (e) {
                // ignore - the setting just won't persist
            }
        },

        // Builds the data array for the SelectionPanel from a visibility map.
        // Locked filters (From / To Date) are always visible, so they are not offered.
        _getAdaptFilterData: function (mVisible) {
            return this._aFilterDefs
                .filter((oDef) => !oDef.locked)
                .map((oDef) => ({
                    name: oDef.key,
                    label: oDef.label,
                    visible: !!mVisible[oDef.key]
                }));
        },

        onOpenFilterSettings: function (oEvent) {
            const oConfigModel = this.getView().getModel("filterConfigModel");

            if (!this._oAdaptPanel) {
                this._oAdaptPanel = new SelectionPanel({
                    fieldColumn: "Field",
                    activeColumn: "Active"
                });

                this._oAdaptPopup = new P13nPopup({
                    title: "Adapt Filters",
                    // Text shown in the confirmation dialog after clicking "Reset"
                    warningText: "Resetting will restore the default filters. Do you want to continue?",
                    panels: [this._oAdaptPanel],
                    reset: () => {
                        this._oAdaptPanel.setP13nData(
                            this._getAdaptFilterData(this._mDefaultVisibleFilters)
                        );
                    },
                    close: (oCloseEvent) => {
                        if (oCloseEvent.getParameter("reason") === "Ok") {
                            this._applyFilterVisibility(this._oAdaptPanel.getP13nData());
                        }
                    }
                });
                this.getView().addDependent(this._oAdaptPopup);
            }

            // Always start from the currently saved state (so Cancel discards changes)
            this._oAdaptPanel.setP13nData(
                this._getAdaptFilterData(oConfigModel.getProperty("/visible"))
            );
            this._oAdaptPopup.open(oEvent.getSource());
        },

        _applyFilterVisibility: function (aPanelData) {
            const oConfigModel = this.getView().getModel("filterConfigModel");
            const mOld = oConfigModel.getProperty("/visible");
            const mNew = Object.assign({}, mOld);

            (aPanelData || []).forEach((oItem) => {
                mNew[oItem.name] = !!oItem.visible;
            });

            this._aFilterDefs.forEach((oDef) => {
                if (oDef.locked) {
                    mNew[oDef.key] = true;
                }
            });

            // Hidden filters must not keep influencing the result -> clear their values
            let bValueCleared = false;
            this._aFilterDefs.forEach((oDef) => {
                if (mOld[oDef.key] && !mNew[oDef.key]) {
                    if (this._clearFilterValue(oDef.key)) {
                        bValueCleared = true;
                    }
                }
            });

            oConfigModel.setProperty("/visible", mNew);
            this._saveFilterVisibility(mNew);

            // Reload only if a filter that was actually in use got hidden
            if (bValueCleared) {
                this.onFilterSearch();
            }
        },

        // Resets one filter to its "empty" state. Returns true if the value changed.
        _clearFilterValue: function (sKey) {
            const oFilterModel = this.getView().getModel("filterModel");

            if (sKey === "fromDate" || sKey === "toDate") {
                const oDefaults = this._getDefaultFilterDates();
                const oCurrent = oFilterModel.getProperty("/" + sKey);
                oFilterModel.setProperty("/" + sKey, oDefaults[sKey]);
                return !oCurrent || oCurrent.getTime() !== oDefaults[sKey].getTime();
            }

            if (sKey === "recommendation") {
                const aCurrent = oFilterModel.getProperty("/recommendation") || [];
                oFilterModel.setProperty("/recommendation", []);
                return aCurrent.length > 0;
            }

            const cfg = this._mVHConfig[sKey];
            const oInput = cfg && this.byId(cfg.inputId);
            if (!oInput) {
                return false;
            }

            // Company Code goes back to its default (keeps the permission-based restriction)
            if (sKey === "companyCode") {
                const aTokens = oInput.getTokens();
                const bChanged = aTokens.length !== 1
                    || aTokens[0].getKey() !== this._oDefaultCompanyCode.key;
                this._applyCompanyCodeDefault(this._bCanChangeCompanyCode);
                return bChanged;
            }

            const bHadValue = oInput.getTokens().length > 0 || !!(oInput.getValue() || "").trim();
            oInput.removeAllTokens();
            oInput.setValue("");
            return bHadValue;
        },

        // SmartTable 'initialise' event: fires once, before the first real bind
        onSmartTableInitialise: function (oEvent) {
            const oSmartTable = oEvent.getSource();

            // Remember the layout defined in the view (needed for "Reset Layout")
            const oCurrent = oSmartTable.getUiState();
            this._oDefaultTableLayout = oCurrent && oCurrent.getPresentationVariant()
                ? JSON.parse(JSON.stringify(oCurrent.getPresentationVariant()))
                : null;

            this._restoreTableLayout(oSmartTable);
        },

        // SmartTable 'uiStateChange' event: fires after the user changed columns / sort / group
        onSmartTableUiStateChange: function (oEvent) {
            if (this._bRestoringTableLayout) {
                return;
            }
            const oSmartTable = oEvent.getSource();

            // Several changes in a row (e.g. OK in the settings dialog) -> save once
            clearTimeout(this._iTableLayoutSaveTimer);
            this._iTableLayoutSaveTimer = setTimeout(() => {
                this._saveTableLayout(oSmartTable);
            }, 300);
        },

        _saveTableLayout: function (oSmartTable) {
            try {
                const oUiState = oSmartTable.getUiState();
                const oPresentationVariant = oUiState && oUiState.getPresentationVariant();
                if (!oPresentationVariant) {
                    return;
                }
                const sNew = JSON.stringify(oPresentationVariant);

                // nothing changed (e.g. event caused by restoring) -> skip
                if (window.localStorage.getItem(this._sTableConfigStorageKey) === sNew) {
                    return;
                }
                window.localStorage.setItem(this._sTableConfigStorageKey, sNew);
            } catch (e) {
                // storage not available - the layout just won't persist
            }
        },

        _restoreTableLayout: function (oSmartTable) {
            let oSaved = null;

            try {
                const sStored = window.localStorage.getItem(this._sTableConfigStorageKey);
                if (sStored) {
                    oSaved = JSON.parse(sStored);
                }
            } catch (e) {
                // storage not available / corrupt -> keep the view defaults
                return;
            }

            if (!oSaved) {
                return;
            }

            this._applyTableLayout(oSmartTable, oSaved);
        },

        _applyTableLayout: function (oSmartTable, oPresentationVariant) {
            this._bRestoringTableLayout = true;
            try {
                oSmartTable.setUiState(new UIState({
                    presentationVariant: oPresentationVariant,
                    selectionVariant: {}
                }));
            } catch (e) {
                // saved layout no longer matches the table (e.g. a column was removed) -> ignore it
                try {
                    window.localStorage.removeItem(this._sTableConfigStorageKey);
                } catch (e2) { /* ignore */ }
            }
            // release the guard after the table has finished reacting
            setTimeout(() => {
                this._bRestoringTableLayout = false;
            }, 500);
        },

        // "Reset Layout" button in the table toolbar
        onResetTableLayout: function () {
            const oSmartTable = this.byId("idSmartTable");

            try {
                window.localStorage.removeItem(this._sTableConfigStorageKey);
            } catch (e) { /* ignore */ }

            if (oSmartTable && this._oDefaultTableLayout) {
                this._applyTableLayout(oSmartTable, this._oDefaultTableLayout);
                oSmartTable.rebindTable(true);
            }
            sap.m.MessageToast.show("Table layout reset to default.");
        },

        // IconTabBar select handler for the status tabs
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
                "CustomerName",
                "AISummaryText",
                "AISummaryVerdict",
                "AISopValueScore",
                "AIAverageDelayScore",
                "AIUtilPercentageScore",
                "CurrentOrderValue",
                "Currency",
                "AIUtilizationPercentage",
                "OutstandingAmount",
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

        // KPI entity path with the date parameters, e.g.
        // /ZC_CE_ORDER_KPI_QUERY(p_date=datetime'2023-09-30T00:00:00',p_from_date=datetime'2023-09-01T00:00:00')/Results
        _getKpiEntityPath: function () {
            const oDates = this._getFormattedFilterDates();
            return `/ZC_CE_ORDER_KPI_QUERY(p_date=datetime'${oDates.to}T00:00:00',p_from_date=datetime'${oDates.from}T00:00:00')/Results`;
        },

        _toNumber: function (vValue) {
            const n = parseFloat(vValue);
            return isNaN(n) ? 0 : n;
        },

        // Loads KPI data with the SAME filters as the list / grid, EXCEPT the status tab
        // (On Hold / Approved / Rejected): the KPI cards always show all statuses.
        // (recommendation, search, company code, order number, customer, division,
        //  business area, utilization %, outstanding amount are still applied)
        _loadKpiData: function () {
            const oView = this.getView();
            const oModel = oView.getModel(this._sKpiModelName)
                || this.getOwnerComponent().getModel(this._sKpiModelName);
            const oKpiModel = oView.getModel("kpiModel");

            if (!oModel || !oKpiModel) {
                return;
            }

            const aFilters = [];
            // true -> do not send the status tab filter to the KPI service
            const oCombinedFilter = this._buildODataFilters(true);
            if (oCombinedFilter) {
                aFilters.push(oCombinedFilter);
            }

            // Ignore responses of outdated requests (user changes filters quickly)
            const iRequestId = ++this._iKpiRequestId;

            oModel.read(this._getKpiEntityPath(), {
                urlParameters: {
                    "$select": [
                        "OrderCount",
                        "IsInHold",
                        "ApprovedOrders",
                        "RejectedOrders",
                        "HighRiskOrders",
                        "CreatedDayRange_1_10",
                        "CreatedDayRange_11_20",
                        "CreatedDayRange_21_31",
                        "CanChangeCompanyCode"
                    ].join(",")
                },
                filters: aFilters,
                success: (oData) => {
                    if (iRequestId !== this._iKpiRequestId) {
                        return;
                    }

                    const aResults = (oData && oData.results) || [];

                    // Normally a single aggregated row; sum defensively if more rows are returned
                    let iTotalOrders = 0;
                    let iInHold = 0;
                    let iApproved = 0;
                    let iRejected = 0;
                    let iHighRisk = 0;
                    let iRange1 = 0;
                    let iRange2 = 0;
                    let iRange3 = 0;

                    aResults.forEach((oRow) => {
                        iTotalOrders += this._toNumber(oRow.OrderCount);
                        iInHold += this._toNumber(oRow.IsInHold);
                        iApproved += this._toNumber(oRow.ApprovedOrders);
                        iRejected += this._toNumber(oRow.RejectedOrders);
                        iHighRisk += this._toNumber(oRow.HighRiskOrders);
                        iRange1 += this._toNumber(oRow.CreatedDayRange_1_10);
                        iRange2 += this._toNumber(oRow.CreatedDayRange_11_20);
                        iRange3 += this._toNumber(oRow.CreatedDayRange_21_31);
                    });

                    const oDefaults = oKpiModel.getData();
                    oKpiModel.setData({
                        ...oDefaults,
                        TotalOrders: iTotalOrders,
                        InHold: iInHold,
                        ApprovedOrders: iApproved,
                        RejectedOrders: iRejected,
                        HighRiskOrders: iHighRisk,
                        DelayRanges: [
                            { label: "1-10", count: iRange1 },
                            { label: "11-20", count: iRange2 },
                            { label: "21-31", count: iRange3 }
                        ]
                    });
                },
                error: (oError) => {
                    if (iRequestId !== this._iKpiRequestId) {
                        return;
                    }
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
            this._clearTableSelection();

            const oSmartTable = this.byId("idSmartTable");
            if (oSmartTable) {
                oSmartTable.rebindTable(true);
            }

            const oOrdersModel = this.getView().getModel("ordersModel");
            const iCurrentPage = oOrdersModel ? oOrdersModel.getProperty("/currentPage") : 1;
            this._loadGridPage(iCurrentPage || 1);
            this._loadKpiData();
        },

        /* =========================================================== */
        /* SINGLE-ORDER ACTIONS (row / card buttons)                   */
        /* =========================================================== */

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

        /* =========================================================== */
        /* BULK ACTIONS (toolbar buttons on the selected rows)         */
        /* =========================================================== */

        onMultiApprove: function () {
            const aOrders = this._getSelectedOrders();

            if (!aOrders.length) {
                MessageBox.warning("Please select at least one order.");
                return;
            }

            this._openCommentDialog({
                action: "multiApprove",
                orders: aOrders,
                title: `Approve ${aOrders.length} Order(s)`,
                confirmButtonText: "Approve"
            });
        },

        onMultiReject: function () {
            const aOrders = this._getSelectedOrders();

            if (!aOrders.length) {
                MessageBox.warning("Please select at least one order.");
                return;
            }

            this._openCommentDialog({
                action: "multiReject",
                orders: aOrders,
                title: `Reject ${aOrders.length} Order(s)`,
                confirmButtonText: "Reject"
            });
        },

        // Promise wrapper around a function import call
        _callFunctionImport: function (oModel, sFunctionPath, mUrlParameters) {
            return new Promise((resolve, reject) => {
                oModel.callFunction(sFunctionPath, {
                    method: "POST",
                    urlParameters: mUrlParameters,
                    success: (oData, oResponse) => resolve({ oData, oResponse }),
                    error: (oError) => reject(oError)
                });
            });
        },

        // Builds the value sent for the Vbeln parameter: an ARRAY of order numbers.
        // OData V2 function-import URL parameters are always sent as text, so the array is
        // serialised here in ONE place. Default: JSON array string -> '["100","200"]'.
        // If the backend expects something else (e.g. comma separated), change only this line.
        _buildVbelnParam: function (aOrderNumbers) {
            return JSON.stringify(aOrderNumbers);
        },

        // Safely reads the sap-message response header -> { severity, message }
        // Also looks into the 'details' of the message (SAP puts further messages there).
        _parseSapMessage: function (oResponse) {
            const sHeader = oResponse && oResponse.headers && oResponse.headers["sap-message"];
            if (!sHeader) {
                return { severity: "", message: "", hasError: false };
            }
            try {
                const oMessage = JSON.parse(sHeader);
                const aDetails = Array.isArray(oMessage.details) ? oMessage.details : [];
                const aAll = [oMessage, ...aDetails];

                const hasError = aAll.some((o) => String(o.severity || "").includes("error"));
                const sAllText = aAll
                    .map((o) => o.message)
                    .filter(Boolean)
                    .join("\n");

                return {
                    severity: oMessage.severity || "",
                    message: sAllText || oMessage.message || "",
                    hasError: hasError
                };
            } catch (e) {
                return { severity: "", message: "", hasError: false };
            }
        },

        // Extracts a readable text from a failed OData request
        _getErrorMessage: function (oError, sFallback) {
            try {
                const oBody = JSON.parse(oError.responseText);
                const sText = oBody?.error?.message?.value;
                if (sText) {
                    return sText;
                }
            } catch (e) { /* not JSON -> fall through */ }
            return (oError && oError.message) || sFallback;
        },

        // Promise version of the credit block release
        _releaseCreditBlockAsync: function (sOrderNumber, sDocCategory) {
            const oCreditModel = this.getOwnerComponent().getModel("API_SLS_DOC_WITH_CREDIT_BLOCK");

            if (!oCreditModel) {
                return Promise.reject(new Error("Credit block release service is not configured."));
            }

            return this._callFunctionImport(oCreditModel, "/ReleaseCreditBlock", {
                SalesDocument: sOrderNumber,
                SDDocumentCategory: sDocCategory
            });
        },

        // Normalises the order objects (single or multi) to { OrderNumber, SDDocumentCategory }
        _toActionOrders: function (aOrders) {
            return (aOrders || [])
                .filter((oOrder) => oOrder && oOrder.OrderNumber)
                .map((oOrder) => ({
                    OrderNumber: oOrder.OrderNumber,
                    SDDocumentCategory: oOrder.SDDocumentCategory || "C"
                }));
        },

        // sAction: "approve" | "reject"
        // aOrders: [{ OrderNumber, SDDocumentCategory }]  (1 entry for single, N for multi)
        // ONE backend call with Vbeln = [ "...", "..." ]
        _executeApprovalAction: async function (sAction, aOrders, sComment) {
            const bApprove = sAction === "approve";
            const sLabel = bApprove ? "Approved" : "Rejected";
            const aActionOrders = this._toActionOrders(aOrders);

            if (!aActionOrders.length) {
                MessageBox.error("No order selected.");
                return;
            }

            const oModel = this.getView().getModel("ZUI_CE_APPR_MATRIX_SB");
            const aOrderNumbers = aActionOrders.map((oOrder) => oOrder.OrderNumber);

            BusyIndicator.show(0);

            try {
                const { oResponse } = await this._callFunctionImport(
                    oModel,
                    bApprove ? "/approve" : "/reject",
                    {
                        Vbeln: this._buildVbelnParam(aOrderNumbers),
                        UserComment: sComment
                    }
                );

                const oSapMessage = this._parseSapMessage(oResponse);

                if (oSapMessage.hasError) {
                    BusyIndicator.hide();
                    // some orders may have been processed -> refresh so the lists are correct
                    this._refreshAllViews();
                    MessageBox.error(oSapMessage.message || `Failed to ${sAction} order(s).`);
                    return;
                }

                // Last approval level reached -> release the credit block as well.
                // The release API works per document, so it runs one by one.
                const aReleaseFailed = [];
                if (bApprove
                    && oSapMessage.message.includes("Final approval completed")
                    && oSapMessage.message.includes("ready for release")) {

                    for (const oOrder of aActionOrders) {
                        try {
                            await this._releaseCreditBlockAsync(oOrder.OrderNumber, oOrder.SDDocumentCategory);
                        } catch (oReleaseError) {
                            aReleaseFailed.push(
                                `${oOrder.OrderNumber} - ${this._getErrorMessage(oReleaseError, "Credit block release failed")}`
                            );
                        }
                    }
                }

                BusyIndicator.hide();
                this._refreshAllViews();

                if (aReleaseFailed.length) {
                    MessageBox.warning(
                        `${sLabel}, but the credit block could not be released for ${aReleaseFailed.length} order(s).`,
                        {
                            title: "Credit block release",
                            details: aReleaseFailed.join("<br>")
                        }
                    );
                    return;
                }

                if (aActionOrders.length === 1) {
                    MessageBox.success(`Order Number - ${aActionOrders[0].OrderNumber} ${sLabel}`);
                } else {
                    MessageBox.success(`${aActionOrders.length} order(s) ${sLabel}`);
                }
            } catch (oError) {
                BusyIndicator.hide();
                const sFallback = aActionOrders.length === 1
                    ? `Failed to ${sAction} order ${aActionOrders[0].OrderNumber}`
                    : `Failed to ${sAction} ${aActionOrders.length} order(s)`;
                MessageBox.error(this._getErrorMessage(oError, sFallback));
            }
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

            if (oPending.action === "approve" || oPending.action === "reject") {
                // single order -> array with one entry
                this._executeApprovalAction(
                    oPending.action,
                    [{ OrderNumber: oPending.orderNumber, SDDocumentCategory: oPending.docCategory }],
                    sComment
                );
            } else if (oPending.action === "multiApprove") {
                this._executeApprovalAction("approve", oPending.orders, sComment);
            } else if (oPending.action === "multiReject") {
                this._executeApprovalAction("reject", oPending.orders, sComment);
            } else if (oPending.action === "reinitiate") {
                this._executeReInitiate(oPending.orderNumber, oPending.docCategory, sComment);
            }

            this._oPendingAction = null;
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
                    this._refreshAllViews();
                    MessageBox.success(`Order Number - ${sOrderNumber} Re Initiated`);
                },
                error: (oError) => {
                    BusyIndicator.hide();
                    MessageBox.error("Failed to reinitiate order " + sOrderNumber);
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

        _getSummaryPlainText: function (sText) {
            if (!sText) {
                return "";
            }
            return String(sText)
                .replace(/\r\n/g, "\n")
                .replace(/^\s*#{1,6}\s+/gm, "")     // headers
                .replace(/^\s*[*-]\s+/gm, "")       // bullets
                .replace(/\*\*(.+?)\*\*/g, "$1")    // bold
                .replace(/\s+/g, " ")               // newlines / extra spaces -> single space
                .trim();
        },

        // Collapsed text: the whole summary on ONE line; the Text control (maxLines=1)
        // cuts it to the column width and adds "..."
        formatSummaryShort: function (sText) {
            return this._getSummaryPlainText(sText) || "No summary available.";
        },

        // "Read more" link is shown whenever there is a summary
        formatSummaryHasMore: function (sText) {
            return !!this._getSummaryPlainText(sText);
        },

        // Read more <-> Show Less: one link, always in the same position (this row only)
        onToggleSummary: function (oEvent) {
            const oLink = oEvent.getSource();
            const oTopRow = oLink.getParent();                  // HBox: [Text, Link]
            const oCell = oTopRow.getParent();                  // outer VBox
            const oShortText = oTopRow.getItems()[0];           // truncated one-line Text
            const oFullText = oCell.getItems()[1];              // FormattedText (full summary)

            const bExpand = !oFullText.getVisible();

            oFullText.setVisible(bExpand);
            oShortText.setVisible(!bExpand);
            oLink.setText(bExpand ? "Show Less" : "Read more");
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