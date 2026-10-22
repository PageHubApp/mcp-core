const importHandlers = require("./remote-import");

module.exports = {
  ...require("./remote-templates"),
  ...require("./remote-sites"),
  ...require("./remote-theme"),
  ...require("./remote-stripe"),
  ...require("./remote-emails"),
  ...require("./remote-site-chat"),
  ...require("./remote-downloads"),
  ...require("./remote-memberships"),
  // Tools only — remote-import also exports helpers the stdio server reuses
  // (re-exported from ../index.js), which must not become tool names.
  import_site: importHandlers.import_site,
  get_import_status: importHandlers.get_import_status,
};
