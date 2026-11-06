/**
 * Development seed: reference data and the first administrator account.
 *
 * It deliberately does not create applications, reviews or download counts.
 * Those only come from real activity, so the marketplace starts empty and fills
 * up as developers publish.
 */
import { config as loadDotenv } from "dotenv";
import { hashPassword } from "@aplora/auth";
import { prisma } from "../src/index";

// Running through tsx does not load .env the way the Prisma CLI does.
loadDotenv();

const CATEGORIES = [
  { name: "Productivity", slug: "productivity", icon: "check-square", description: "Notes, tasks, documents and focus tools." },
  { name: "Communication", slug: "communication", icon: "message-circle", description: "Messaging, calls and mail." },
  { name: "Photography", slug: "photography", icon: "camera", description: "Capture, edit and organise images." },
  { name: "Finance", slug: "finance", icon: "wallet", description: "Budgets, payments and expense tracking." },
  { name: "Education", slug: "education", icon: "graduation-cap", description: "Learning, revision and reference." },
  { name: "Entertainment", slug: "entertainment", icon: "play", description: "Video, audio and reading." },
  { name: "Utilities", slug: "utilities", icon: "wrench", description: "System tools and everyday helpers." },
  { name: "Health & Fitness", slug: "health-fitness", icon: "heart-pulse", description: "Activity, sleep and wellbeing." },
  { name: "Travel", slug: "travel", icon: "map", description: "Maps, transport and trip planning." },
  { name: "Games", slug: "games", icon: "gamepad-2", description: "Puzzles, strategy and casual play." },
];

const SETTINGS = [
  { key: "platform.name", value: "Aplora" },
  { key: "platform.tagline", value: "Discover. Explore. Install." },
  { key: "reviews.require_verified_email", value: true },
  { key: "uploads.max_apk_size_mb", value: 200 },
  { key: "moderation.auto_publish_after_approval", value: true },
];

async function main(): Promise<void> {
  for (const [index, category] of CATEGORIES.entries()) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      create: { ...category, sortOrder: index },
      update: { name: category.name, description: category.description, icon: category.icon, sortOrder: index },
    });
  }
  console.log(`Seeded ${CATEGORIES.length} categories`);

  for (const setting of SETTINGS) {
    await prisma.setting.upsert({
      where: { key: setting.key },
      create: { key: setting.key, value: setting.value },
      update: { value: setting.value },
    });
  }
  console.log(`Seeded ${SETTINGS.length} platform settings`);

  const collections = [
    {
      slug: "editors-picks",
      title: "Editor's picks",
      description: "Applications the editorial team keeps coming back to.",
      sortOrder: 0,
    },
    {
      slug: "new-this-week",
      title: "New this week",
      description: "Recently published releases worth a look.",
      sortOrder: 1,
    },
  ];
  for (const collection of collections) {
    await prisma.collection.upsert({
      where: { slug: collection.slug },
      create: collection,
      update: { title: collection.title, description: collection.description },
    });
  }
  console.log(`Seeded ${collections.length} collections`);

  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@aplora.local";
  const password = process.env.SEED_ADMIN_PASSWORD ?? "ChangeMe12345!";
  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    console.log(`Administrator ${email} already exists, leaving it untouched`);
  } else {
    await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword(password),
        displayName: "Aplora Administrator",
        role: "SUPER_ADMIN",
        emailVerifiedAt: new Date(),
      },
    });
    console.log(`Created administrator ${email}`);
    console.log(`  password: ${password}`);
    console.log("  Change this password after signing in, and enable two-factor authentication.");
  }

  const counts = await Promise.all([
    prisma.user.count(),
    prisma.app.count(),
    prisma.category.count(),
  ]);
  console.log(`Database now holds ${counts[0]} users, ${counts[1]} applications and ${counts[2]} categories.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
