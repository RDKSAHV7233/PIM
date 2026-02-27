import Link from "next/link";
import { createAttributeDefinitionAction, createCategoryAction, createProductAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getCategories, getProducts, getStats } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [stats, categories, products] = await Promise.all([getStats(), getCategories(), getProducts()]);

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">PIM1 Phase 1-3 Console</h1>
        <p className="text-sm text-slate-600">
          Catalog source of truth with compliance intelligence and marketplace readiness simulation.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <Card>
          <p className="text-xs uppercase text-slate-500">Categories</p>
          <p className="text-2xl font-semibold">{stats.categories}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-slate-500">Products</p>
          <p className="text-2xl font-semibold">{stats.products}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-slate-500">Variants</p>
          <p className="text-2xl font-semibold">{stats.variants}</p>
        </Card>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle>Create Category</CardTitle>
          <form action={createCategoryAction} className="space-y-3">
            <Input name="name" placeholder="Category name" required />
            <Select name="parentId" defaultValue="">
              <option value="">No parent</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.path}
                </option>
              ))}
            </Select>
            <Button type="submit">Create category</Button>
          </form>
        </Card>

        <Card>
          <CardTitle>Create Product</CardTitle>
          <form action={createProductAction} className="space-y-3">
            <Input name="title" placeholder="Product title" required />
            <Input name="brand" placeholder="Brand" />
            <Textarea name="description" rows={3} placeholder="Description" />
            <Input name="hsnCode" placeholder="HSN code (4/6/8 digits)" />
            <Input name="gstRate" type="number" min={0} step="0.01" placeholder="GST rate (e.g. 18)" />
            <Textarea
              name="attributes"
              rows={3}
              placeholder='Product attributes JSON, e.g. {"material":"cotton","fit":"regular"}'
            />
            <Select name="categoryId" required defaultValue="">
              <option value="" disabled>
                Select category
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.path}
                </option>
              ))}
            </Select>
            <Select name="status" defaultValue="draft">
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </Select>
            <Button type="submit">Create product</Button>
          </form>
        </Card>
      </section>

      <Card>
        <CardTitle>Create Category Attribute Definition</CardTitle>
        <form action={createAttributeDefinitionAction} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Select name="categoryId" required defaultValue="">
            <option value="" disabled>
              Select category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.path}
              </option>
            ))}
          </Select>
          <Input name="name" placeholder="Display name (e.g. Fabric Type)" required />
          <Input name="key" placeholder="Key (e.g. fabric_type)" required />
          <Select name="dataType" defaultValue="text">
            <option value="text">text</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="select">select</option>
            <option value="json">json</option>
          </Select>
          <Select name="required" defaultValue="true">
            <option value="true">required</option>
            <option value="false">optional</option>
          </Select>
          <Select name="appliesTo" defaultValue="product">
            <option value="product">product</option>
            <option value="variant">variant</option>
          </Select>
          <Textarea
            name="allowedValues"
            rows={2}
            className="md:col-span-2 lg:col-span-3"
            placeholder='Allowed values JSON array, e.g. ["cotton","silk"]'
          />
          <Button type="submit" className="w-fit">
            Add attribute definition
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Categories</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Name</th>
                <th className="py-2">Path</th>
                <th className="py-2">Slug</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => (
                <tr key={category.id} className="border-t border-border">
                  <td className="py-2">{category.name}</td>
                  <td className="py-2">{category.path}</td>
                  <td className="py-2">{category.slug}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle>Products</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Title</th>
                <th className="py-2">Brand</th>
                <th className="py-2">HSN</th>
                <th className="py-2">GST %</th>
                <th className="py-2">Category</th>
                <th className="py-2">Status</th>
                <th className="py-2">Variants</th>
                <th className="py-2">Validation Issues</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-t border-border">
                  <td className="py-2">
                    <Link href={`/products/${product.id}`}>{product.title}</Link>
                  </td>
                  <td className="py-2">{product.brand || "-"}</td>
                  <td className="py-2">{product.hsnCode || "-"}</td>
                  <td className="py-2">{product.gstRate ?? "-"}</td>
                  <td className="py-2">{product.category?.path ?? product.categoryId}</td>
                  <td className="py-2">{product.status}</td>
                  <td className="py-2">{product.variants?.length ?? 0}</td>
                  <td className="py-2">{product.validationIssues?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
