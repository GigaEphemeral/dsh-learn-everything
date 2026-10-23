window.__ModuleLoader__.load({ id: "dsh-learn-everything", factory: (require) => {
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);
var import_react = require("react");
var name = "dsh-learn-everything";
var inject = ["slots", "sidebarRightTabs"];
function apply(ctx) {
  ctx.inject(["sidebarRightTabs"], (injected) => {
    const tabs = injected.get("sidebarRightTabs");
    if (!tabs || typeof tabs.register !== "function") return;
    ctx.effect(() => {
      const disposeType = tabs.register({
        id: "obsidian",
        kind: "dsh-learn-everything:obsidian",
        keepMounted: true,
        priority: "extension",
        title: () => "Obsidian",
        guide: [{
          id: "dsh-learn-everything:obsidian",
          order: 150,
          title: () => "Obsidian",
          description: () => "Obsidian \u77E5\u8BC6\u5E93\u8BBF\u95EE\u9762\u677F\uFF08S4\uFF09"
        }]
      });
      const offBody = ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
        name: "obsidian",
        inject: (sessionId) => ({ sessionId, component: ObsidianPanel })
      }));
      const offTitle = ctx.slots.inject("sidebar.right.pane.tab.title", () => ctx.slots.register({
        name: "obsidian",
        inject: (sessionId) => ({ sessionId, title: "Obsidian" })
      }));
      return () => {
        disposeType();
        offBody();
        offTitle();
      };
    });
  });
}
function ObsidianPanel(props) {
  return (0, import_react.createElement)(
    "div",
    { style: { padding: 12 } },
    "Obsidian \u9762\u677F\uFF08R1 \u5360\u4F4D\uFF09\u2014 session: " + (props.sessionId ?? "?")
  );
}
return module.exports; } });
