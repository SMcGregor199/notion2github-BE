export function getNotionImageBlock(pageContent) {
    return pageContent?.results?.find((block) => block?.type === "image" && block.image);
}

export function getNotionImageUrl(imageBlock) {
    if (!imageBlock?.image) {
        return null;
    }

    if (imageBlock.image.type === "external") {
        return imageBlock.image.external?.url ?? null;
    }

    if (imageBlock.image.type === "file") {
        return imageBlock.image.file?.url ?? null;
    }

    return imageBlock.image.file?.url ?? imageBlock.image.external?.url ?? null;
}

export function getNotionImageUrlFromPageContent(pageContent) {
    return getNotionImageUrl(getNotionImageBlock(pageContent));
}
