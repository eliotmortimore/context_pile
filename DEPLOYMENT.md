# Deployment & Feature Workflow

This guide outlines the professional workflow for developing and deploying new features to **ContextPile**. Following this process ensures stability and prevents breaking changes on the live site.

## 1. The Feature Branch Workflow

Never edit the `main` branch directly. Always work in an isolated "feature branch".

### Step 1: Start a New Feature
Update your local repository and create a new branch.

```bash
# Switch to main and get latest changes
git checkout main
git pull origin main

# Create a new branch (name it descriptive: feature/name or fix/issue)
git checkout -b feature/my-new-feature
```

### Step 2: Develop & Test
Write your code. Run the development server to test changes in real-time.

```bash
npm run dev
# Open http://localhost:3000
```

### Step 3: Database Changes (If applicable)
If you modify `prisma/schema.prisma`:

1. **Update Schema**: Edit the file.
2. **Sync Database**: Run the push command to update your connected database (Supabase).
   ```bash
   npx prisma db push
   ```
3. **Regenerate Client**: Update the type definitions.
   ```bash
   npx prisma generate
   ```

### Step 4: Verify Build
Before committing, ensure the project builds successfully. This catches type errors and broken imports.

```bash
npm run build
```
*If this fails, fix the errors before proceeding.*

### Step 5: Save & Push
Commit your changes and push the branch to GitHub.

```bash
git add .
git commit -m "Description of what I changed"
git push origin feature/my-new-feature
```

---

## 2. Deployment (Vercel)

We use Vercel for continuous deployment.

### Preview Deployments
When you push a **Feature Branch** (Step 5 above), Vercel automatically builds a **Preview URL**.
1. Go to your Vercel Dashboard.
2. You will see the deployment under "Project Activity".
3. Click the URL (e.g., `context-pile-git-feature-x.vercel.app`) to test the feature in a live environment.

### Production Deployment
To go live:
1. Go to the GitHub repository.
2. Open a **Pull Request (PR)** from your feature branch to `main`.
3. Click **"Merge Pull Request"**.

**Vercel detects the merge to `main` and automatically deploys the new version to your production domain.**

---

## 3. Environment Variables

If your new feature requires new secret keys (e.g., a new API key):

1. **Local**: Add them to your local `.env` file.
2. **Production**: Add them to **Vercel Settings** -> **Environment Variables**.
   * *Note: You must add these BEFORE merging to main, otherwise the build will fail.*

## 4. Troubleshooting

*   **Build Fails on Vercel**: Check the "Logs" tab in the Vercel dashboard. It usually indicates a TypeScript error or missing Environment Variable.
*   **Database Error**: Ensure you ran `npx prisma db push` if you changed the schema. Vercel does not automatically migrate your database unless configured to do so.
