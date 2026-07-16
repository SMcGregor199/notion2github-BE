import { config } from "dotenv";
config({ quiet: true });
import slugify from "slugify";
import fs from "fs/promises";
import { Client } from "@notionhq/client";
import { NotionToMarkdown } from "notion-to-md";
import {
    createStableImageId,
    publicImageUrlForBlockId,
    publicImageUrlForImageId,
    registerNotionImageSource,
} from "./notionPublicImages.js";

const notion = new Client({
    auth: process.env.NOTION_API_KEY,
});

const DATABASE_PROPERTIES = {
    title: "Name",
    published: "Published",
    tag: "Tag",
    summary: "Summary",
    slug: "Slug",
    featureImage: "Feature Image",
};

async function getChildPages(pageId) {
    try {
        const databaseId = process.env.NOTION_DATABASE_ID;
        if (databaseId) {
            return getDatabasePosts(databaseId);
        }

        return getLegacyChildPages(pageId);
    } catch (err) {
        console.error("Error fetching child pages:", err);
        throw err;
    }
}

async function getLegacyChildPages(pageId) {
    const response = await notion.blocks.children.list({ block_id: pageId });
    const pagesArray = await Promise.all(
        response.results
            .filter((page) => page.type === "child_page")
            .map(async (page) => {
                const thePageId = page.id;
                const pageContent = await getPageContentById(thePageId);
                const tag = extractTagFromPageContent(pageContent);
                const title = await getPageTitleById(thePageId);
                const summary = extractSummaryFromPageContent(pageContent);
                const link = slugify(title, { lower: true });
                const thumbnail = publicImageUrlForBlockId(thePageId);
                const body = await getPageBodyContent(thePageId);
                const bodyMarkdown = await getPageBodyMarkdown(thePageId, pageContent);
                const [publishedDate, updatedDate] = await getPageMetadataById(thePageId);
                return {
                    id: thePageId,
                    tag,
                    title,
                    summary,
                    link,
                    thumbnail,
                    body,
                    bodyMarkdown,
                    publishedDate,
                    updatedDate,
                };
            })
    );

    return pagesArray;
}

async function getDatabasePosts(databaseId) {
    const pages = await queryDatabasePages(databaseId);
    const publicPages = pages.filter(isPublishedDatabasePage);

    return Promise.all(
        publicPages.map(async (page) => {
            const pageContent = await getPageContentById(page.id);
            const title = getTitleFromPage(page) || "Untitled post";
            const legacyTag = extractTagFromPageContent(pageContent);
            const legacySummary = extractSummaryFromPageContent(pageContent);
            const tag = getTagFromPage(page) || legacyTag;
            const summary = getRichTextProperty(page, DATABASE_PROPERTIES.summary) || legacySummary;
            const link = normalizeSlug(getRichTextProperty(page, DATABASE_PROPERTIES.slug)) || slugify(title, { lower: true });
            const thumbnail = await resolveFeaturedImageUrl(page, pageContent);
            const bodyMarkdown = await getPageBodyMarkdown(page.id, pageContent);

            return {
                id: page.id,
                tag,
                title,
                summary,
                link,
                thumbnail,
                bodyMarkdown,
                publishedDate: page.created_time || "",
                updatedDate: page.last_edited_time || "",
            };
        })
    );
}

async function queryDatabasePages(databaseId) {
    const dataSourceId = await resolveDataSourceId(databaseId);
    const pages = [];
    let cursor;

    do {
        const response = await notion.dataSources.query({
            data_source_id: dataSourceId,
            page_size: 100,
            start_cursor: cursor,
            sorts: [{ timestamp: "created_time", direction: "descending" }],
        });
        pages.push(...response.results);
        cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return pages;
}

async function resolveDataSourceId(databaseOrDataSourceId) {
    const normalizedId = String(databaseOrDataSourceId || "").replace(/^collection:\/\//, "");
    try {
        const database = await notion.databases.retrieve({ database_id: normalizedId });
        return database?.data_sources?.[0]?.id || normalizedId;
    } catch {
        return normalizedId;
    }
}

function isPublishedDatabasePage(page) {
    const property = page?.properties?.[DATABASE_PROPERTIES.published];
    return property?.type === "checkbox" && property.checkbox === true;
}

function getTitleFromPage(page) {
    const preferred = getTitleProperty(page, DATABASE_PROPERTIES.title);
    if (preferred) {
        return preferred;
    }

    const titleProperty = Object.values(page?.properties || {}).find((property) => property?.type === "title");
    return plainTextFromRichText(titleProperty?.title || []);
}

function getTitleProperty(page, propertyName) {
    const property = page?.properties?.[propertyName];
    if (property?.type !== "title") {
        return "";
    }

    return plainTextFromRichText(property.title || []);
}

function getRichTextProperty(page, propertyName) {
    const property = page?.properties?.[propertyName];
    if (property?.type !== "rich_text") {
        return "";
    }

    return plainTextFromRichText(property.rich_text || []);
}

function getTagFromPage(page) {
    const property = page?.properties?.[DATABASE_PROPERTIES.tag];
    if (property?.type === "select") {
        return property.select?.name || "";
    }

    if (property?.type === "multi_select") {
        return property.multi_select?.[0]?.name || "";
    }

    if (property?.type === "rich_text") {
        return plainTextFromRichText(property.rich_text || []);
    }

    return "";
}

async function resolveFeaturedImageUrl(page, pageContent) {
    const propertySource = getFilePropertyUrl(page, DATABASE_PROPERTIES.featureImage);
    const coverSource = getNotionFileUrl(page?.cover);
    const sourceUrl = propertySource || coverSource;

    if (sourceUrl) {
        const imageId = createStableImageId(page.id, sourceUrl);
        await registerNotionImageSource(imageId, sourceUrl);
        return publicImageUrlForImageId(imageId);
    }

    return publicImageUrlForBlockId(page.id) || legacyFirstImageUrl(pageContent);
}

function getFilePropertyUrl(page, propertyName) {
    const property = page?.properties?.[propertyName];
    if (property?.type !== "files" || !Array.isArray(property.files)) {
        return "";
    }

    const file = property.files[0];
    if (!file) {
        return "";
    }

    return getNotionFileUrl(file);
}

function legacyFirstImageUrl(pageContent) {
    const block = Array.isArray(pageContent?.results)
        ? pageContent.results.find((item) => item?.type === "image")
        : null;
    const url = getNotionFileUrl(block?.image);
    return typeof url === "string" ? url : "";
}

function normalizeSlug(value) {
    return typeof value === "string" ? slugify(value.trim(), { lower: true }) : "";
}

async function getPageContentById(pageId) {
    try {
        let cursor;
        let lastResponse = null;
        const results = [];
        do {
            lastResponse = await notion.blocks.children.list({ block_id: pageId, start_cursor: cursor });
            results.push(...lastResponse.results);
            cursor = lastResponse.has_more ? lastResponse.next_cursor : undefined;
        } while (cursor);

        return { ...lastResponse, results };
    } catch (err) {
        console.error("Error fetching page content:", err);
        throw err;
    }
}

async function getPageTitleById(pageId) {
    try {
        const page = await notion.pages.retrieve({ page_id: pageId });
        return page.properties.title.title[0].plain_text;
    } catch (err) {
        console.log("Error fetching page title:", err);
        throw err;
    }
}

async function getPageBodyContent(pageId, pageContent) {
    const content = pageContent || await getPageContentById(pageId);
    return serializeNotionBodyBlocks(getBodyBlocksFromPageContent(content));
}

async function getPageBodyMarkdown(pageId, pageContent) {
    const content = pageContent || await getPageContentById(pageId);
    const bodyBlocks = getBodyBlocksFromPageContent(content);
    const n2m = new NotionToMarkdown({
        notionClient: notion,
        config: { parseChildPages: false },
    });

    n2m.setCustomTransformer("image", async (block) => {
        const sourceUrl = getNotionFileUrl(block?.image);
        const caption = plainTextFromRichText(block?.image?.caption || []) || "image";
        if (!sourceUrl) {
            return "";
        }

        const imageId = createStableImageId(block.id || pageId, sourceUrl);
        await registerNotionImageSource(imageId, sourceUrl);
        return `![${escapeMarkdownAlt(caption)}](${publicImageUrlForImageId(imageId)})`;
    });

    const markdownBlocks = await n2m.blocksToMarkdown(bodyBlocks);
    const markdownString = n2m.toMarkdownString(markdownBlocks);
    return (markdownString.parent || "").trim();
}

function serializeNotionBodyBlocks(blocks = []) {
    const grouped = [];
    const currentSection = () => {
        if (grouped.length === 0) {
            grouped.push({ heading: "", paras: [], blocks: [] });
        }
        return grouped[grouped.length - 1];
    };

    blocks.forEach((block) => {
        const serializedBlock = serializeNotionBlock(block);
        if (!serializedBlock) {
            return;
        }

        const isSectionHeading = serializedBlock.type === "heading_3";
        const section = isSectionHeading
            ? { heading: plainTextFromBlock(serializedBlock), paras: [], blocks: [] }
            : currentSection();

        section.blocks.push(serializedBlock);
        if (serializedBlock.type === "paragraph") {
            section.paras.push(serializedBlock.text);
        }

        if (isSectionHeading) {
            grouped.push(section);
        }
    });

    return grouped;
}

function serializeNotionBlock(block) {
    if (!block || typeof block !== "object") {
        return null;
    }

    const type = block.type || "unsupported";
    const text = serializeRichText(getBlockRichText(block));

    if (["heading_1", "heading_2", "heading_3", "paragraph", "quote", "callout"].includes(type)) {
        return { type, text };
    }

    if (["bulleted_list_item", "numbered_list_item"].includes(type)) {
        return { type, text };
    }

    if (type === "to_do") {
        return { type, text, checked: block.to_do?.checked === true };
    }

    if (type === "code") {
        return { type, text: plainTextFromRichText(getBlockRichText(block)), language: block.code?.language || "" };
    }

    if (type === "divider") {
        return { type };
    }

    if (type === "image") {
        const url = getNotionFileUrl(block.image);
        const caption = serializeRichText(block.image?.caption || []);
        return { type, url, caption };
    }

    if (["bookmark", "embed", "link_preview", "video", "file", "pdf"].includes(type)) {
        const href = getNotionFileUrl(block[type]) || block[type]?.url || block[type]?.link_preview?.url || "";
        const caption = serializeRichText(block[type]?.caption || []);
        return { type, href, caption };
    }

    const fallbackText = text || serializeRichText(block[type]?.caption || []);
    return { type: "unsupported", originalType: type, text: fallbackText };
}

function getBodyBlocksFromPageContent(pageContent) {
    const blocks = Array.isArray(pageContent?.results) ? [...pageContent.results] : [];
    if (isHistoricalSummaryBlock(blocks[0])) {
        blocks.shift();
    }
    if (isHistoricalTagBlock(blocks[blocks.length - 1])) {
        blocks.pop();
    }
    return blocks;
}

function extractSummaryFromPageContent(pageContent) {
    const firstBlock = Array.isArray(pageContent?.results) ? pageContent.results[0] : null;
    return isHistoricalSummaryBlock(firstBlock) ? plainTextFromRichText(getBlockRichText(firstBlock)) : "";
}

function extractTagFromPageContent(pageContent) {
    const lastBlock = Array.isArray(pageContent?.results) ? pageContent.results[pageContent.results.length - 1] : null;
    if (!isHistoricalTagBlock(lastBlock)) {
        return "";
    }

    const tagPart = lastBlock.to_do.rich_text[1] || lastBlock.to_do.rich_text[0];
    return tagPart?.plain_text || tagPart?.text?.content || "";
}

function isHistoricalSummaryBlock(block) {
    return block?.type === "heading_3" && plainTextFromRichText(getBlockRichText(block));
}

function isHistoricalTagBlock(block) {
    return block?.type === "to_do" && Array.isArray(block.to_do?.rich_text) && block.to_do.rich_text.length > 0;
}

function getBlockRichText(block) {
    if (!block?.type) {
        return [];
    }

    const blockValue = block[block.type];
    return Array.isArray(blockValue?.rich_text) ? blockValue.rich_text : [];
}

function getNotionFileUrl(fileValue) {
    if (!fileValue || typeof fileValue !== "object") {
        return "";
    }
    if (fileValue.type === "external") {
        return fileValue.external?.url || "";
    }
    if (fileValue.type === "file") {
        return fileValue.file?.url || "";
    }
    return fileValue.external?.url || fileValue.file?.url || "";
}

function plainTextFromBlock(block) {
    return plainTextFromSerializedText(block?.text);
}

function plainTextFromSerializedText(value) {
    if (typeof value === "string") {
        return value;
    }
    if (!Array.isArray(value)) {
        return "";
    }
    return value.map((part) => typeof part?.text === "string" ? part.text : "").join("");
}

function serializeRichText(richText = []) {
    const hasLink = richText.some((part) => getRichTextHref(part));
    const hasBold = richText.some((part) => isBoldRichText(part));
    if (!hasLink && !hasBold) {
        return plainTextFromRichText(richText);
    }

    return richText.map((part) => {
        const span = { text: part.plain_text || "" };
        const href = getRichTextHref(part);
        if (href) {
            span.href = href;
        }
        if (isBoldRichText(part)) {
            span.bold = true;
        }
        return span;
    }).filter((part) => part.text);
}

function plainTextFromRichText(richText = []) {
    return richText.map((part) => part.plain_text || "").join("");
}

function getRichTextHref(part) {
    return part?.href || part?.text?.link?.url || "";
}

function isBoldRichText(part) {
    return part?.annotations?.bold === true;
}

function escapeMarkdownAlt(value) {
    return String(value || "").replace(/[[\]\\]/g, "\\$&").replace(/\n+/g, " ").trim();
}

async function getPageMetadataById(pageId) {
    const page = await notion.pages.retrieve({ page_id: pageId });
    return [page.created_time, page.last_edited_time];
}

async function savePagesToFile(id) {
    try {
        const childPagesContent = await getChildPages(id);
        const jsContent = `export const blogPostsData = ${JSON.stringify(childPagesContent, null, 2)};\n`;
        await fs.writeFile("/tmp/notionBlogData.js", jsContent);
        console.log("notionBlogData.js successfully written.");
        return childPagesContent;
    } catch (err) {
        console.error("Error writing file:", err);
        throw err;
    }
}

export {
    savePagesToFile,
    serializeRichText,
    serializeNotionBodyBlocks,
    serializeNotionBlock,
    getBodyBlocksFromPageContent,
    getPageBodyMarkdown,
    isPublishedDatabasePage,
};
