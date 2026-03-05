const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
prisma.category
  .findUnique({ where: { id: "x", tenantKey: "default" } })
  .then((value) => {
    console.log("ok", value);
  })
  .catch((error) => {
    console.error(String(error?.message ?? error));
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
