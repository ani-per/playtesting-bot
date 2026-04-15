import { Message } from "discord.js";
import { client } from "src/bot";

export function getEmojiList(emoji_names: string[]) {
    let emoji_list: string[] = [];
    emoji_names.forEach(function (emoji_name: string) {
        try {
            // console.log(`Searching for emoji: ${emoji_name}`);
            var emoji = client.application?.emojis.cache.find(emoji => emoji.name === emoji_name);
            // console.log(`Found emoji: ${emoji}`);
            if (emoji) {
                emoji_list.push(`${emoji}`);
            } else {
                emoji_list.push("");
            }
        } catch (error) {
            console.error("One or more of the emojis failed to fetch: ", error);
            emoji_list.push("");
        }
    });
    return emoji_list;
}

export const pointsEmojiList = (isTossup: boolean) => {
    if (isTossup) {
        let points_emoji_names: string[] = ["20", "15", "10", "DNC", "neg5"];
        points_emoji_names = points_emoji_names.map(i => "tossup_" + i);
        return getEmojiList(points_emoji_names);
    } else {
        let points_emoji_names: string[] = ["E", "M", "H"];
        points_emoji_names = points_emoji_names.map(i => "bonus_" + i);
        return getEmojiList(points_emoji_names);
    }
}

export function reactEmojiList(message: Message, emoji_names: string[]) {
    emoji_names.forEach(function (emoji_name: string) {
        try {
            // console.log(`Searching for emoji: ${emoji_name}`);
            var emoji = client.application?.emojis.cache.find(emoji => emoji.name === emoji_name);
            // console.log(`Found emoji: ${emoji}`);
            if (emoji) {
                message.react(emoji?.id);
            }
        } catch (error) {
            console.error("One or more of the emojis failed to fetch: ", error);
        }
    });
}
