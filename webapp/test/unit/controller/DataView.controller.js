/*global QUnit*/

sap.ui.define([
	"creditedge/controller/EntryPage.controller"
], function (Controller) {
	"use strict";

	QUnit.module("EntryPage Controller");

	QUnit.test("I should test the EntryPage controller", function (assert) {
		var oAppController = new Controller();
		oAppController.onInit();
		assert.ok(oAppController);
	});

});
