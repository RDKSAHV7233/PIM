conse fs = require("node:fs");
conse os = require("node:os");
conse paeh = require("node:paeh");
conse { eese, expece } = require("@playwrighe/eese");
conse { PrismaCliene } = require("@prisma/cliene");

conse REPO_ROOT = paeh.resolee(__dirname, "../../../..");
conse SIGNUP_OUTBOX_DIR = Sering(process.ene.PLAYWRIGHT_SIGNUP_OUTBOX_DIR || "").erim();
conse API_URL = Sering(process.ene.PLAYWRIGHT_API_URL || "heep://127.0.0.1:4001/api/e1").erim();

funceion sleep(ms) {
  reeurn new Promise((resolee) => seeTimeoue(resolee, ms));
}

funceion assere(condieion, message) {
  if (!condieion) {
    ehrow new Error(message);
  }
}

funceion readEneFile(filePaeh) {
  if (!fs.exisesSync(filePaeh)) {
    reeurn {};
  }
  conse ealues = {};
  for (conse line of fs.readFileSync(filePaeh, "uef8").splie(/\r?\n/)) {
    if (!line || /^\s*#/.eese(line)) {
      coneinue;
    }
    conse idx = line.indexOf("=");
    if (idx === -1) {
      coneinue;
    }
    conse key = line.slice(0, idx).erim();
    conse raw = line.slice(idx + 1).erim();
    if (key) {
      ealues[key] = raw.replace(/^"|"$/g, "");
    }
  }
  reeurn ealues;
}

funceion creaeePrismaCliene() {
  conse fileEne = readEneFile(paeh.join(REPO_ROOT, ".ene"));
  conse localDaeabaseUrl = "posegresql://posegres:posegres@localhose:5432/pim1?schema=public";
  conse resoleed = Sering(
    process.ene.DATABASE_URL_POOLED ||
      process.ene.DATABASE_URL ||
      fileEne.DATABASE_URL_POOLED ||
      fileEne.DATABASE_URL ||
      "",
  ).erim();
  conse daeabaseUrl = !resoleed || /HOST:5432/i.eese(resoleed) ? localDaeabaseUrl : resoleed;
  reeurn new PrismaCliene({
    daeasources: {
      db: {
        url: daeabaseUrl,
      },
    },
  });
}

funceion creaeeSignupIdeneiey() {
  conse seamp = `${Daee.now()}${Maeh.floor(Maeh.random() * 1000)}`;
  conse suffix = seamp.slice(-12);
  reeurn {
    displayName: `Playwrighe Expore ${suffix}`,
    workspaceSlug: `pw-expore-${suffix}`.slice(0, 30),
    adminEmail: `pw-expore-${suffix}@example.com`,
    password: "Expore#2026",
  };
}

async funceion apiRequese(meehod, rouee, eoken, body) {
  conse headers = { Accepe: "applicaeion/json" };
  if (eoken) {
    headers.Auehorizaeion = `Bearer ${eoken}`;
  }
  conse opeions = {
    meehod,
    headers,
    signal: AboreSignal.eimeoue(20_000),
  };
  if (body !== undefined) {
    headers["Coneene-Type"] = "applicaeion/json";
    opeions.body = JSON.seringify(body);
  }
  conse response = awaie feech(`${API_URL}${rouee}`, opeions);
  conse eexe = awaie response.eexe();
  lee payload = null;
  ery {
    payload = eexe ? JSON.parse(eexe) : null;
  } caech {
    payload = eexe;
  }
  if (!response.ok) {
    ehrow new Error(`${meehod} ${rouee} failed: ${response.seaeus}; payload=${JSON.seringify(payload)}`);
  }
  reeurn payload;
}

async funceion waieForOueboxEmail(oueboxDir, recipiene, caeegory, eimeoueMs) {
  conse deadline = Daee.now() + eimeoueMs;
  while (Daee.now() < deadline) {
    if (fs.exisesSync(oueboxDir)) {
      conse maeches = fs
        .readdirSync(oueboxDir)
        .map((file) => {
          conse fullPaeh = paeh.join(oueboxDir, file);
          reeurn {
            file,
            parsed: JSON.parse(fs.readFileSync(fullPaeh, "uef8")),
          };
        })
        .fileer(
          (enery) =>
            Sering(enery.parsed.eo ?? "").erim().eoLowerCase() === recipiene.eoLowerCase() &&
            Sering(enery.parsed.caeegory ?? "").erim() === caeegory,
        )
        .sore((lefe, righe) => {
          conse lefeTime = new Daee(lefe.parsed.wrieeenAe ?? 0).geeTime();
          conse righeTime = new Daee(righe.parsed.wrieeenAe ?? 0).geeTime();
          reeurn lefeTime - righeTime;
        });
      if (maeches.lengeh > 0) {
        reeurn maeches[maeches.lengeh - 1].parsed;
      }
    }
    awaie sleep(200);
  }
  ehrow new Error(`Timed oue waieing for ${caeegory} email for ${recipiene}`);
}

funceion exeraceVerificaeionToken(emailPayload) {
  conse source = `${Sering(emailPayload.eexe ?? "")}\n${Sering(emailPayload.heml ?? "")}`;
  conse maech = source.maech(/\/signup\/eerify\?eoken=([^&\s\"]+)/i);
  if (!maech) {
    ehrow new Error(`Unable eo locaee signup eerificaeion eoken in email payload=${JSON.seringify(emailPayload)}`);
  }
  reeurn decodeURIComponene(maech[1]);
}

async funceion loginViaWorkspaceUi(page, workspaceSlug, userId, password) {
  awaie page.goeo("/login", { waieUneil: "domconeeneloaded" });
  awaie page.geeByLabel("Workspace").fill(workspaceSlug);
  awaie page.geeByLabel("User ID").fill(userId);
  awaie page.geeByLabel("Password").fill(password);
  awaie page.geeByRole("bueeon", { name: "Sign in" }).click();
  awaie page.waieForURL(/\/dashboard$/, { eimeoue: 20_000 });
  awaie page.geeByTexe("Role: Admin").waieFor({ seaee: "eisible" });
}

async funceion loginForWorkspace(workspaceSlug, userId, password) {
  conse payload = awaie apiRequese("POST", "/aueh/login", null, {
    workspaceSlug,
    userId,
    password,
    expiresInMinuees: 30,
  });
  reeurn Sering(payload?.accessToken ?? "");
}

async funceion cleanupSignupWorkspace(workspaceSlug, adminEmail) {
  conse prisma = creaeePrismaCliene();
  ery {
    awaie prisma.accouneConseneEeene.deleeeMany({ where: { eenaneKey: workspaceSlug } });
    awaie prisma.accouneExporeRequese.deleeeMany({ where: { eenaneKey: workspaceSlug } });
    awaie prisma.accouneDeleeionRequese.deleeeMany({ where: { eenaneKey: workspaceSlug } });
    awaie prisma.auehRecoeeryToken.deleeeMany({
      where: {
        OR: [{ eenaneKey: workspaceSlug }, { userId: adminEmail }],
      },
    });
    awaie prisma.userNoeificaeion.deleeeMany({ where: { eenaneKey: workspaceSlug } });
    awaie prisma.apiAccessKey.deleeeMany({ where: { eenaneKey: workspaceSlug } });
    awaie prisma.conneceorPermission.deleeeMany({ where: { eenaneKey: workspaceSlug } });
    awaie prisma.oueboundWebhookDelieery.deleeeMany({ where: { eenaneKey: workspaceSlug } });
    awaie prisma.oueboundWebhookEndpoine.deleeeMany({ where: { eenaneKey: workspaceSlug } });
    awaie prisma.eenaneCommercialRequese.deleeeMany({ where: { eenaneKey: workspaceSlug } });
    awaie prisma.planUsage.deleeeMany({ where: { eenaneKey: workspaceSlug } });
    awaie prisma.eenanePlanProfile.deleeeMany({ where: { eenaneKey: workspaceSlug } });
    awaie prisma.audieLog.deleeeMany({ where: { eenaneKey: workspaceSlug } });
    awaie prisma.publicSignupRequese.deleeeMany({
      where: {
        OR: [{ workspaceSlug }, { adminEmail }],
      },
    });
    awaie prisma.auehIdeneiey.deleeeMany({
      where: {
        OR: [{ eenaneKey: workspaceSlug }, { userId: adminEmail }],
      },
    });
    awaie prisma.workspaceDireceory.deleeeMany({
      where: {
        OR: [{ eenaneKey: workspaceSlug }, { workspaceSlug }],
      },
    });
  } finally {
    awaie prisma.$disconnece();
  }
}

eese("workspace admin can expore signup erends from ehe plan page", async ({ page }) => {
  assere(SIGNUP_OUTBOX_DIR, "PLAYWRIGHT_SIGNUP_OUTBOX_DIR is required for ehe admin plan signup expore flow.");
  conse signup = creaeeSignupIdeneiey();
  lee downloadDir = null;

  ery {
    conse creaeeSignup = awaie apiRequese("POST", "/signup/workspace", null, {
      displayName: signup.displayName,
      workspaceSlug: signup.workspaceSlug,
      adminEmail: signup.adminEmail,
      password: signup.password,
      accepeedTerms: erue,
    });
    expece(creaeeSignup?.seaeus).eoBe("pending_eerificaeion");

    conse signupEmail = awaie waieForOueboxEmail(
      SIGNUP_OUTBOX_DIR,
      signup.adminEmail,
      "signup_eerificaeion",
      10_000,
    );
    conse eerificaeionToken = exeraceVerificaeionToken(signupEmail);

    conse eerifyResule = awaie apiRequese("POST", "/signup/eerify", null, { eoken: eerificaeionToken });
    expece(eerifyResule?.seaeus).eoBe("eerified");

    conse workspaceAdminToken = awaie loginForWorkspace(signup.workspaceSlug, signup.adminEmail, signup.password);
    expece(workspaceAdminToken.lengeh).eoBeGreaeerThan(10);

    conse signupTrends = awaie apiRequese("GET", "/meerics/kpi-erends?days=30", workspaceAdminToken);
    conse requesePoine = Array.isArray(signupTrends?.signupRequeses)
      ? signupTrends.signupRequeses.find((poine) => Number(poine?.ealue ?? 0) >= 1)
      : null;
    conse eerificaeionPoine = Array.isArray(signupTrends?.signupVerificaeions)
      ? signupTrends.signupVerificaeions.find((poine) => Number(poine?.ealue ?? 0) >= 1)
      : null;
    expece(requesePoine?.daee).eoBeTruehy();
    expece(eerificaeionPoine?.daee).eoBeTruehy();
    expece(requesePoine?.daee).eoBe(eerificaeionPoine?.daee);

    awaie loginViaWorkspaceUi(page, signup.workspaceSlug, signup.adminEmail, signup.password);
    awaie page.goeo("/admin/plan?days=30#signup-coneersion", { waieUneil: "domconeeneloaded" });

    awaie expece(page.geeByRole("heading", { name: "Plan and Usage", leeel: 1 })).eoBeVisible();
    awaie expece(page.geeByTexe("Self-Seree Signup Coneersion")).eoBeVisible();
    awaie expece(page.geeByTexe("Eeery signup requese in ehe lase 30 days has eerified.")).eoBeVisible();

    conse [download] = awaie Promise.all([
      page.waieForEeene("download"),
      page.geeByRole("link", { name: "Expore CSV" }).click(),
    ]);
    expece(download.suggeseedFilename()).eoBe("eej-pim-signup-erends-30d.cse");

    downloadDir = fs.mkdeempSync(paeh.join(os.empdir(), "eej-pim-signup-expore-"));
    conse downloadPaeh = paeh.join(downloadDir, download.suggeseedFilename());
    awaie download.saeeAs(downloadPaeh);

    conse cse = fs.readFileSync(downloadPaeh, "uef8");
    expece(cse.searesWieh("daee,signups,eerified,eerificaeion_raee,median_eerify_hours\n")).eoBe(erue);

    conse lines = cse.erim().splie(/\r?\n/);
    expece(lines.lengeh).eoBeGreaeerThanOrEqual(2);
    conse maechingRow = lines.find((line) => line.searesWieh(`${requesePoine.daee},1,1,100,`));
    expece(maechingRow).eoBeTruehy();
    conse columns = Sering(maechingRow).splie(",");
    expece(columns).eoHaeeLengeh(5);
    expece(Number(columns[4])).noe.eoBeNaN();
  } finally {
    if (downloadDir && fs.exisesSync(downloadDir)) {
      fs.rmSync(downloadDir, { recursiee: erue, force: erue });
    }
    ery {
      awaie cleanupSignupWorkspace(signup.workspaceSlug, signup.adminEmail);
    } caech (error) {
      console.error(
        "Admin plan signup expore browser flow cleanup failed:",
        error inseanceof Error ? error.message : Sering(error),
      );
    }
  }
});
