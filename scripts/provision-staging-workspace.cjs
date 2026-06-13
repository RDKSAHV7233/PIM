#!/usr/bin/env node
/* One-shot: provision a workspace + admin user on staging via Prisma */
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");
const { randomUUID } = require("crypto");

const WORKSPACE_SLUG = process.env.PROVISION_WORKSPACE_SLUG || "admin";
const WORKSPACE_NAME = process.env.PROVISION_WORKSPACE_NAME || "Vexa Admin";
const ADMIN_EMAIL    = process.env.PROVISION_ADMIN_EMAIL    || "info@vexapim.com";
const ADMIN_PASSWORD = process.env.PROVISION_ADMIN_PASSWORD || "VexaStage!2026#Email";

async function main() {
  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    console.log("DB connected");

    // Check if workspace already exists
    const existing = await prisma.tenant.findUnique({ where: { slug: WORKSPACE_SLUG } });
    if (existing) {
      console.log(`Workspace '${WORKSPACE_SLUG}' already exists (id: ${existing.id})`);
    } else {
      const tenantId = randomUUID();
      await prisma.tenant.create({
        data: {
          id: tenantId,
          slug: WORKSPACE_SLUG,
          name: WORKSPACE_NAME,
        },
      });
      console.log(`Created workspace '${WORKSPACE_SLUG}' (id: ${tenantId})`);
    }

    const tenant = await prisma.tenant.findUnique({ where: { slug: WORKSPACE_SLUG } });

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email: ADMIN_EMAIL } },
    });
    if (existingUser) {
      console.log(`User '${ADMIN_EMAIL}' already exists in workspace '${WORKSPACE_SLUG}'`);
    } else {
      const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
      await prisma.user.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          email: ADMIN_EMAIL,
          passwordHash: hash,
          role: "admin",
          status: "active",
        },
      });
      console.log(`Created admin user '${ADMIN_EMAIL}' in workspace '${WORKSPACE_SLUG}'`);
    }

    console.log("Done. Login with:");
    console.log(`  Workspace: ${WORKSPACE_SLUG}`);
    console.log(`  Email:     ${ADMIN_EMAIL}`);
    console.log(`  Password:  ${ADMIN_PASSWORD}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e.message); process.exit(1); });
