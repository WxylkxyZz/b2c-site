import { resolveProductIds } from "../resolve-product-ids"

describe("resolveProductIds", () => {
  it("returns product ids from either a single or batched event payload", async () => {
    const query = {
      graph: jest.fn(),
      search: jest.fn(),
    }

    await expect(
      resolveProductIds(
        { name: "product.created", data: { id: "prod_1" } },
        { container: { query } } as any,
      ),
    ).resolves.toEqual(["prod_1"])

    await expect(
      resolveProductIds(
        {
          name: "product.updated",
          data: [{ id: "prod_2" }, {}, { id: "prod_3" }],
        },
        { container: { query } } as any,
      ),
    ).resolves.toEqual(["prod_2", "prod_3"])
    expect(query.graph).not.toHaveBeenCalled()
    expect(query.search).not.toHaveBeenCalled()
  })

  it.each([
    {
      event: "product-variant.updated",
      entity: "product_variant",
      fields: ["product_id"],
      data: [{ product_id: "prod_variant" }],
      expected: ["prod_variant"],
      withDeleted: false,
    },
    {
      event: "product-option.updated",
      entity: "product_option",
      fields: ["product_id"],
      data: [{ product_id: "prod_option" }],
      expected: ["prod_option"],
      withDeleted: false,
    },
    {
      event: "product-option-value.deleted",
      entity: "product_option_value",
      fields: ["option.product_id"],
      data: [{ option: { product_id: "prod_option_value" } }],
      expected: ["prod_option_value"],
      withDeleted: true,
    },
    {
      event: "product-tag.updated",
      entity: "product_tag",
      fields: ["products.id"],
      data: [{ products: [{ id: "prod_tag" }] }],
      expected: ["prod_tag"],
      withDeleted: false,
    },
    {
      event: "product-category.deleted",
      entity: "product_category",
      fields: ["products.id"],
      data: [{ products: [{ id: "prod_category" }] }],
      expected: ["prod_category"],
      withDeleted: true,
    },
  ])("resolves products for $event", async ({
    event,
    entity,
    fields,
    data,
    expected,
    withDeleted,
  }) => {
    const query = {
      graph: jest.fn().mockResolvedValue({ data }),
      search: jest.fn(),
    }

    await expect(
      resolveProductIds(
        { name: event, data: { id: "related_1" } },
        { container: { query } } as any,
      ),
    ).resolves.toEqual(expected)

    expect(query.graph).toHaveBeenCalledWith({
      entity,
      fields,
      filters: { id: ["related_1"] },
      withDeleted,
    })
    expect(query.search).not.toHaveBeenCalled()
  })

  it("loads deleted variants with deleted rows and returns their products", async () => {
    const query = {
      graph: jest.fn().mockResolvedValue({
        data: [{ product_id: "prod_1" }, { product_id: null }],
      }),
      search: jest.fn(),
    }

    await expect(
      resolveProductIds(
        { name: "product-variant.deleted", data: { id: "variant_1" } },
        { container: { query } } as any,
      ),
    ).resolves.toEqual(["prod_1"])

    expect(query.graph).toHaveBeenCalledWith({
      entity: "product_variant",
      fields: ["product_id"],
      filters: { id: ["variant_1"] },
      withDeleted: true,
    })
  })

  it("paginates sales-channel search results in batches of 200", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => ({
      id: `prod_${index}`,
    }))
    const query = {
      graph: jest.fn(),
      search: jest
        .fn()
        .mockResolvedValueOnce({ search_result: { hits: firstPage } })
        .mockResolvedValueOnce({
          search_result: { hits: [{ id: "prod_last" }] },
        }),
    }

    const productIds = await resolveProductIds(
      { name: "sales-channel.deleted", data: { id: "sc_1" } },
      { container: { query } } as any,
    )

    expect(productIds).toHaveLength(201)
    expect(productIds.at(-1)).toBe("prod_last")
    expect(query.search).toHaveBeenNthCalledWith(1, {
      entity: "product",
      fields: ["id"],
      filters: { sales_channel_ids: ["sc_1"] },
      pagination: { skip: 0, take: 200 },
    })
    expect(query.search).toHaveBeenNthCalledWith(2, {
      entity: "product",
      fields: ["id"],
      filters: { sales_channel_ids: ["sc_1"] },
      pagination: { skip: 200, take: 200 },
    })
  })

  it("ignores malformed payloads and unrelated events without querying", async () => {
    const query = {
      graph: jest.fn(),
      search: jest.fn(),
    }
    const context = { container: { query } } as any

    await expect(
      resolveProductIds({ name: "product.updated", data: null }, context),
    ).resolves.toEqual([])
    await expect(
      resolveProductIds(
        { name: "inventory-level.updated", data: { id: "level_1" } },
        context,
      ),
    ).resolves.toEqual([])

    expect(query.graph).not.toHaveBeenCalled()
    expect(query.search).not.toHaveBeenCalled()
  })
})
