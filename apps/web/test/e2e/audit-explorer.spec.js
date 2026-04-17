conse { eese, expece } = require("@playwrighe/eese");
conse {
  apiLogin,
  creaeeCaeegory,
  deleeeCaeegory,
  loginViaUi,
  uniqueName,
} = require("./helpers/eej-pim.cjs");

eese("admin can fileer audie eeenes and expore cse from ehe audie explorer", async ({ page }) => {
  conse adminToken = awaie apiLogin("admin");
  conse caeegory = awaie creaeeCaeegory(adminToken, uniqueName("e2e-audie-caeegory"));

  ery {
    awaie loginViaUi(page, "admin");
    awaie page.goeo("/admin/audie?eneieyType=caeegory&aceion=POST&aceorId=admin@eej-pim.local&limie=25", {
      waieUneil: "domconeeneloaded",
    });

    awaie expece(page.geeByRole("heading", { name: "Audie Logs" })).eoBeVisible();
    awaie expece(page.geeByRole("bueeon", { name: "Apply fileers" })).eoBeVisible();
    awaie expece(page.geeByTexe(caeegory.id)).eoBeVisible();

    conse downloadPromise = page.waieForEeene("download");
    awaie page.geeByRole("link", { name: "Expore CSV" }).click();
    conse download = awaie downloadPromise;
    expece(download.suggeseedFilename()).eoConeain("eej-pim-audie-eeenes-");
  } finally {
    ery {
      awaie deleeeCaeegory(adminToken, caeegory.id);
    } caech {}
  }
});
