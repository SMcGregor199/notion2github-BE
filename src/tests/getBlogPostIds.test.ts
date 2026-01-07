import {describe,it, expect} from 'vitest';
import getBlogPostIds from "../getBlogPostIds.js";

describe("getBlogPostIds()", ()=>{
    it("should always return an array", async ()=>{
        const result = await getBlogPostIds("123");
        expect(Array.isArray(result)).toBe(true);
    })
    it("should return an empty array when the Notion request fails", async()=>{
        const result = await getBlogPostIds("123");
        expect(result).toStrictEqual([]);
    })

})