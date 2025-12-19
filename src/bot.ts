import { Client, GatewayIntentBits, Partials, ChannelType, Interaction, TextChannel, TextThreadChannel, Events, EmbedBuilder } from "discord.js";
import { config } from "./config";
import handleTossupPlaytest from "./handlers/tossupHandler";
import handleBonusPlaytest from "./handlers/bonusHandler";
import handleNewQuestion from "./handlers/newQuestionHandler";
import handleConfig from "./handlers/configHandler";
import handleButtonClick from "./handlers/buttonClickHandler";
import handleCategoryCommand from "./handlers/categoryCommandHandler";
import handleTally from "./handlers/bulkQuestionHandler";
import { sleep, QuestionType, UserBonusProgress, UserProgress, UserTossupProgress, getBulkQuestions, getBulkQuestionsInPacket, getServerChannels, getServerSettings, saveEchoSetting, deleteEchoSetting, getEchoThreadId, updatePacketName, getEchoSettings, cleanPacketName, printPacketName, deleteBulkPacket } from "./utils";
import handleAuthorCommand from "./handlers/authorCommandHandler";

const userProgressMap = new Map<string, UserProgress>();

const startCommands = ["start", "read", "begin"];
const getCommands = ["packet", "status", "round", "info"];
const stopCommands = ["stop", "quit"];
const clearCommands = ["reset", "clear"];
const helpCommands = ["commands", "help"];
const packetCommands = [
    ...startCommands,
    ...stopCommands,
    ...getCommands,
];
const tallyCommands = [
    ...startCommands,
    ...stopCommands,
    "tally", "count",
];
const deleteCommands = ["delete", "purge"];

const helpEmbed = new EmbedBuilder()
    .setColor(0x0099FF)
    .setTitle("Overview")
    .setURL("https://github.com/ani-per/playtesting-bot")
    .setAuthor({ name: "Playtesting Bot", url: "https://github.com/ani-per/playtesting-bot" })
    .setDescription([
        "* [README](https://github.com/ani-per/playtesting-bot/blob/main/README.md)",
        "* [Instructions for Editors](https://gist.github.com/acfquizbowl/7983064671e257b15de96547ef192129#instructions-for-editors)",
        "* [Instructions for Playtesters](https://gist.github.com/acfquizbowl/7983064671e257b15de96547ef192129#instructions-for-playtesters)",
        "* [Paster Dingus](https://minkowski.space/quizbowl/paster/)",
        "* [File an issue on GitHub](https://github.com/JemCasey/playtesting-bot/issues)",
    ].join("\n")
    )
    .addFields(
        { name: "Bot Configuration", value: "`!config`" },
        {
            name: "Bulk Playtesting Commands",
            value: [
                "* `!start X`/`!read X`/`!begin X` - Begin reading packet `X`",
                "* `!packet`/`!round` - Display current packet",
                "* `!stop`/`!quit` - Stop reading the current packet",
                "* `!delete X` - Delete packet `X` and its questions",
                "* `!tally` - Tally reacts for the current packet",
                "* `!tally X` - Tally reacts for packet `X`",
            ].join("\n"),
        },
    )
    .setTimestamp();

export const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Channel,
        Partials.Message,
        Partials.Reaction
    ],
    allowedMentions: {
        parse: []
    }
});

client.once(Events.ClientReady, async (client) => {
    let emojis = await client?.application?.emojis.fetch();
    console.log(`Logged in as ${client.user.tag} with ${emojis.size} application emojis.`);
    let emojiList = emojis.map(e => `\t${e.name}`).join("\n");
    // console.log(emojiList);
});

client.on("messageCreate", async (message) => {
    try {
        if (message.author.id === config.DISCORD_APPLICATION_ID)
            return;
        if (message.content.startsWith("!config")) {
            await handleConfig(message);
        } else if (
            [...packetCommands, ...tallyCommands, ...deleteCommands, ...helpCommands].some(
                v => message.content.startsWith("!" + v)
            )
        ) {
            let serverId = message.guild!.id;
            let echoChannelId = getServerChannels(serverId).find(c => (c.channel_type === 3))?.channel_id;
            let currentServerSetting = getServerSettings(serverId).find(ss => ss.server_id == serverId);
            let currentPacket = currentServerSetting?.packet_name || "";
            let splits = message.content.split(" ");
            let command = splits[0];
            let packetArgument = splits.length > 1 ? splits.slice(1).join(" ").trim() : "";
            let cleanedPacketName = cleanPacketName(packetArgument);
            let startPacket = startCommands.some(v => command.startsWith("!" + v));
            let clearPacket = clearCommands.some(v => packetArgument.startsWith(v));
            let endPacket = stopCommands.some(v => command.startsWith("!" + v)) || clearPacket;
            let getPacket = getCommands.some(v => command.startsWith("!" + v));
            let noPacket = false;
            let packetToTally = cleanPacketName(packetArgument);
            if (packetCommands.some(v => message.content.startsWith("!" + v))) {
                if (endPacket || startPacket) {
                    if (
                        startPacket &&
                        packetArgument &&
                        (cleanedPacketName === currentPacket)
                    ) {
                        message.reply(`${printPacketName(cleanedPacketName)} is already being read.`);
                    } else {
                        if (
                            endPacket ||
                            (
                                startPacket &&
                                currentPacket &&
                                packetArgument
                            )
                        ) {
                            let endMessage = [""];
                            let closingVerb = "";
                            if (
                                stopCommands.some(v => command.startsWith("!" + v)) ||
                                packetArgument.startsWith("end") ||
                                (startPacket && currentPacket)
                            ) {
                                closingVerb = "ended";
                            } else {
                                closingVerb = "been cleared";
                            }
                            if (currentPacket) {
                                updatePacketName(serverId, "");
                                packetToTally = currentPacket;
                                endMessage.push(`Reading of ${printPacketName(currentPacket)} has ${closingVerb}.`);
                            } else if (packetArgument) {
                                updatePacketName(serverId, "");
                                let packetBulkQuestions = getBulkQuestionsInPacket(serverId, cleanedPacketName);
                                if (packetBulkQuestions.length > 0) {
                                    endMessage.push(`${printPacketName(cleanedPacketName)} ${closingVerb}.`);
                                } else {
                                    endMessage.push(`${printPacketName(cleanedPacketName)} not found.`);
                                }
                            } else {
                                noPacket = true;
                            }
                            if (
                                startPacket &&
                                currentPacket &&
                                packetArgument
                            ) {
                                endMessage.push(`Preparing to read ${printPacketName(cleanedPacketName)} ...`);
                            }
                            message.reply(endMessage.join(" "));
                        }
                        if (startPacket && packetArgument) {
                            let newPacketName = updatePacketName(serverId, cleanedPacketName);
                            currentPacket = newPacketName;
                            let printPacket = printPacketName(currentPacket);
                            if (echoChannelId) {
                                let echoChannel = (client.channels.cache.get(echoChannelId) as TextChannel);
                                let echoThreadId = getEchoThreadId(serverId, echoChannelId, newPacketName);
                                if (!echoThreadId) {
                                    let packetMessage = await echoChannel.send(`## [${printPacket}](${message.url})`);
                                    if (packetMessage) {
                                        let newEchoThread = await packetMessage.startThread({
                                            name: printPacket.replaceAll("\`", ""),
                                            autoArchiveDuration: 60
                                        });
                                        saveEchoSetting(serverId, echoChannelId, newPacketName, newEchoThread?.id);
                                        message.reply(`Reading of [${printPacket}](${newEchoThread.url}) has begun.`);
                                    }
                                } else {
                                    let echoThread = echoChannel!.threads.cache.find(x => x.id === echoThreadId) as TextThreadChannel;
                                    message.reply(`Resumed reading of [${printPacket}](${echoThread.url}).`);
                                }
                            } else {
                                message.reply("Could not begin reading. An echo channel has not been configured.");
                            }
                        }
                    }
                } else if (getPacket) {
                    if (packetArgument) {
                        let packetBulkQuestions = getBulkQuestionsInPacket(serverId, cleanedPacketName);
                        message.reply(`${packetBulkQuestions.length} questions have been read as part of ${printPacketName(cleanedPacketName)}.`);
                    } else if (currentPacket) {
                        message.reply(`The current packet is ${printPacketName(currentPacket)}.`);
                    } else {
                        noPacket = true;
                    }
                }
            }
            if (tallyCommands.some(v => command.startsWith("!" + v))) {
                if (packetToTally) {
                    if (packetToTally.includes("all")) {
                        [...new Set(getBulkQuestions(serverId).map(u => u.packet_name))].forEach(async packet => {
                            let tallyBulkQuestions = getBulkQuestionsInPacket(serverId, packet);
                            if (tallyBulkQuestions.length > 0) {
                                await handleTally(serverId, packet, message);
                            } else {
                                message.reply(`No questions to tally in Packet ${packet}.`);
                            }
                        });
                    } else if (
                        !(startPacket && (packetToTally === currentPacket))
                    ) {
                        let tallyBulkQuestions = getBulkQuestionsInPacket(serverId, packetToTally);
                        if (tallyBulkQuestions.length > 0) {
                            await handleTally(serverId, packetToTally, message);
                        } else {
                            message.reply(`No questions to tally in Packet \`${packetToTally}\`.`);
                        }
                    }
                } else {
                    if (endPacket && currentPacket) {
                        await handleTally(serverId, currentPacket, message);
                    } else if (packetArgument) {
                        noPacket = true;
                    }
                }
            }
            if (noPacket) {
                message.reply("No packet is being read right now.");
            }
            if (deleteCommands.some(v => command.startsWith("!" + v))) {
                if (packetArgument) {
                    if (echoChannelId) {
                        let deleteMessage = [""];
                        let echoSetting = getEchoSettings(serverId, echoChannelId).find(es => es.packet_name === cleanedPacketName);
                        if (echoSetting) {
                            deleteEchoSetting(serverId, cleanedPacketName);
                            let echoChannel = (client.channels.cache.get(echoSetting.channel_id) as TextChannel);
                            let echoThread = echoChannel!.threads.cache.find(x => x.id === echoSetting.thread_id) as TextThreadChannel;
                            let echoMessage = await echoChannel!.messages.fetch(echoSetting.thread_id);
                            if (echoMessage) {
                                await echoMessage.delete();
                            }
                            await echoThread.delete();
                            deleteBulkPacket(serverId, cleanedPacketName);
                            if (currentPacket === cleanedPacketName) {
                                updatePacketName(serverId, "");
                                deleteMessage.push(`Reading of ${printPacketName(currentPacket)} has ended.`);
                            }
                            deleteMessage.push(`${printPacketName(cleanedPacketName)} and its associated thread have been deleted.`);
                            message.reply(deleteMessage.join(" "));
                        } else {
                            message.reply(`${printPacketName(cleanedPacketName)} does not exist.`);
                        }
                    } else {
                        message.reply("Echo channel not configured.");
                    }
                } else {
                    message.reply("No packet name was provided to delete settings.");
                }
            }
            if (helpCommands.some(v => message.content.startsWith("!" + v))) {
                await sleep(1000);
                message.reply({ embeds: [helpEmbed] })
            }
        } else if (message.content.startsWith("!category")) {
            await handleCategoryCommand(message);
        } else if (message.content.startsWith("!author")) {
            await handleAuthorCommand(message);
        } else {
            let setUserProgress = userProgressMap.set.bind(userProgressMap);
            let deleteUserProgress = userProgressMap.delete.bind(userProgressMap);

            if (message.channel.type !== ChannelType.DM && message.content.includes("ANSWER:")) {
                await handleNewQuestion(message);
            } else if (message.channel.type === ChannelType.DM) {
                let userProgress = userProgressMap.get(message.author.id)

                if (userProgress?.type === QuestionType.Tossup) {
                    await handleTossupPlaytest(message, client, userProgress as UserTossupProgress, setUserProgress, deleteUserProgress);
                } else if (userProgress?.type === QuestionType.Bonus) {
                    await handleBonusPlaytest(message, client, userProgress as UserBonusProgress, setUserProgress, deleteUserProgress);
                }
            }
        }
    } catch (e) {
        console.log(e);
    }
});

client.on("interactionCreate", async (interaction: Interaction) => {
    try {
        await handleButtonClick(interaction, userProgressMap, userProgressMap.set.bind(userProgressMap));
    } catch (e) {
        console.log(e);
    }
});

client.login(config.DISCORD_TOKEN);
