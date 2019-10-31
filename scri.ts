import chalk from "ansi-colors";
import fs from "fs";
import glob from "glob";
import path from "path";
import { ProcessHelper as psh, scri } from "scriptastic";

const server = "docker.io";
const organization = "transpiria";

function getFullTag(image: string, tag?: string): string {
    return tag ?
        `${image}:${tag}` :
        image;
}

function getBuildTaskName(fullTag: string): string {
    return `Build ${fullTag}`;
}

function getPushTaskName(fullTag: string): string {
    return `Push ${fullTag}`;
}

function getFullImage(fullTag: string): string {
    var fullImage = `${organization}/${fullTag}`;
    if (server) {
        fullImage = `${server}/${fullImage}`;
    }
    return fullImage;
}

function fillReplacements(content: string, file: string): string {
    const replacementSearch = /#{replace:(.+)}#/g;
    let match = replacementSearch.exec(content);
    while (match) {
        let directory = path.dirname(file);
        let replacement: string;
        let testDirectory: string;
        do {
            testDirectory = path.join(directory, ".replacements", match[1]);
            if (fs.existsSync(testDirectory)) {
                replacement = testDirectory;
            }
            directory = path.dirname(directory);
        } while (!replacement && !testDirectory.startsWith(".replacement"));

        if (replacement) {
            const replacementContent = fs.readFileSync(replacement, { encoding: "utf-8" });
            content = content.replace(match[0], replacementContent);
        }

        match = replacementSearch.exec(content);
    }

    return content;
}

async function fillFunctions(content: string): Promise<string> {
    const scripts = require("./.scripts.ts");

    const replacementSearch = /#{function:(.+)}#/g;
    let match = replacementSearch.exec(content);
    while (match) {
        const replacement = await scripts[match[1]]();
        content = content.replace(match[0], replacement);

        match = replacementSearch.exec(content);
    }

    return content;
}

scri.task("Collect Images")
    .does(async () => {
        const buildImagesTask = scri.task("Build Images");

        for (const dockerFile of glob.sync("**/dockerfile")) {
            const tagPath = path.dirname(dockerFile);
            const imagePath = path.dirname(tagPath);
            const tag = path.basename(tagPath);
            const image = path.basename(imagePath);

            const fullTag = getFullTag(image, tag);
            const fullImage = getFullImage(fullTag);

            const buildImageTask = scri.task(getBuildTaskName(fullTag))
                .does(async () => {
                    const command = `docker build -f ${dockerFile} --pull -t ${fullImage} --build-arg NOCACHE=$(date +%s) ${tagPath}`;
                    console.log(chalk.green(command));
                    psh.executeSync(command);
                });
            const pushImageTask = scri.task(getPushTaskName(fullTag))
                .dependsOn(buildImageTask)
                .does(() => {
                    const command = `docker push ${fullImage}`;
                    console.log(chalk.green(command));
                    psh.executeSync(command);
                });
            buildImagesTask.dependsOn(pushImageTask.name);

            let content = fs.readFileSync(dockerFile, { encoding: "utf-8" });
            content = fillReplacements(content, dockerFile);
            content = await fillFunctions(content);

            const dependencySearch = /#{image:([^:]+):([^#]+)}#/g;
            let match = dependencySearch.exec(content);
            while (match) {
                const dependencyFullTag = getFullTag(match[1], match[2]);
                const dependencyFullImage = getFullImage(dependencyFullTag);
                content = content.replace(match[0], dependencyFullImage);
                buildImageTask.dependsOn(getPushTaskName(dependencyFullTag));

                match = dependencySearch.exec(content);
            }
            fs.writeFileSync(dockerFile, content, { encoding: "utf-8" });
        }

        scri.runTask(buildImagesTask.name);
    });

scri.task("build")
    .dependsOn("Collect Images");

scri.task("default")
    .dependsOn("build");
