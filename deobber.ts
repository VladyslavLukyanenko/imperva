const folder = "./";
const fileName = "reese";

import * as fs from "fs";
import * as t from "@babel/types";
import { parse } from "@babel/parser";
import traverse, { NodePath } from "@babel/traverse";
import generate from "@babel/generator";
import * as vm from "vm";

const context = {};
let testing_opts = {
    comments: false,
    minified: true,
    concise: true,
    retainFunctionParens: true
}

let beautify_opts = {
    comments: true,
    minified: false,
    concise: false,
    retainFunctionParens: true
}

const allowedIdentifierCharsAndFirstChars = new Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$".split(""));
const allowedIdentifierChars = new Set('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$0123456789'.split(""));
function isValidIdentifierName(name) {
    if (!allowedIdentifierCharsAndFirstChars.has(name[0])) return false;
    for (let i = 1; i < name.length; i++) {
        if (!allowedIdentifierChars.has(name[i])) return false;
    }
    return true;
}
const file = fs.readFileSync(folder + fileName + ".js", "utf-8");
let AST = parse(file, { sourceType: "module" });

function genTestingNode(node) {
    return generate(node, testing_opts).code;
}

function isEmptyObject(node: t.VariableDeclaration) {
    return node.declarations.length === 1 &&
        t.isVariableDeclarator(node.declarations[0]) &&
        t.isObjectExpression(node.declarations[0].init) &&
        node.declarations[0].init.properties.length === 0;
}

// function isWantedAssignExpr(node: t.AssignmentExpression) {
//   return node.operator === "=" &&
//     t.isMemberExpression(node.left) &&
//     t.isIdentifier(node.left.object) &&
//     ["StringLiteral", "FunctionExpression"].includes(node.right.type) &&
//     emptyObjects.has(node.left.object.name)
// }


let substrStrings: Set<string> = new Set();
traverse(AST, {
    CallExpression(path) {
        const { node } = path;
        if (!t.isMemberExpression(node.callee)) return;
        if (node.callee.computed === true) return;
        if (!t.isIdentifier(node.callee.property)) return;
        if (node.callee.property.name !== "substr") return;
        if (!t.isIdentifier(node.callee.object)) return;

        substrStrings.add(node.callee.object.name);
    }
})

const stringDeobbingContext = {};
stringDeobbingContext["window"] = globalThis;

traverse(AST, {
    Program: {
        enter(path) {
            const wantedPath = path.get("body.0.expression.callee.body") as NodePath<t.BlockStatement>;
            wantedPath.get("body").forEach(nodePath => {
                const { node: insideNode } = nodePath;
                if (!(
                    t.isVariableDeclaration(insideNode) ||
                    t.isFunctionDeclaration(insideNode) ||
                    t.isLoop(insideNode)
                )) return;

                // check for these var declarations:
                // var a = b; // reference
                if (nodePath.isVariableDeclaration()) {
                    nodePath.get("declarations").forEach(varDeclPath => {
                        const { node } = varDeclPath;
                        if (!t.isIdentifier(node.init)) return;
                        if (!t.isIdentifier(node.id)) return;
                        varDeclPath.scope.rename(node.id.name, node.init.name);
                        varDeclPath.remove();
                    })
                }
                try {
                    vm.runInNewContext(genTestingNode(insideNode), stringDeobbingContext);
                    // all loops are just to populate stuff
                    if (t.isLoop(insideNode)) nodePath.remove();
                } catch (e) {
                    console.error("ERROR AT INITIAL STRING RUNNING INSTRUCTIONS\n%s", (e as Error).message);
                }
            })
        },
        exit(path) {
            const wantedPath = path.get("body.0.expression.callee.body") as NodePath<t.BlockStatement>;
            wantedPath.scope.crawl();
            let nodePaths = wantedPath.get("body");
            let hasAnythingBeenDeleted: boolean;
            do {
                hasAnythingBeenDeleted = false;
                for (let i = 0; i < nodePaths.length; i++) {
                    const nodePath = nodePaths[i];
                    if (!nodePath.isVariableDeclaration()) continue;
                    // console.log("WE GOT TO VARIABLE DECLARATION")
                    nodePath.get("declarations").forEach(varDeclPath => {
                        const { node } = varDeclPath;
                        if (!t.isIdentifier(node.id)) return;
                        const binding = varDeclPath.scope.getBinding(node.id.name);
                        if (binding.referenced) return;
                        varDeclPath.remove();
                        hasAnythingBeenDeleted = true;
                    })
                }
                wantedPath.scope.crawl();
            } while (hasAnythingBeenDeleted);
        }
    },
    CallExpression(path) {
        const { node } = path;
        if (!t.isMemberExpression(node.callee)) return;
        if (node.callee.computed === true) return;
        if (!t.isIdentifier(node.callee.property)) return;
        if (node.callee.property.name !== "substr") return;
        if (!t.isIdentifier(node.callee.object)) return;
        // __IDENTIFIER__.substr()

        try {
            let value = t.stringLiteral(vm.runInNewContext(genTestingNode(node), stringDeobbingContext));
            path.replaceWith(value);
        } catch (e) {
            console.error("ERROR TRYING TO REPLACE SUBSTR METHODS\n%s", (e as Error).message);
        }
    }
})

traverse(AST, {
    MemberExpression(path) {
        if (!(path.node.computed === true &&
            t.isStringLiteral(path.node.property))) return;
        if (!isValidIdentifierName(path.node.property.value)) return;
        path.node.computed = false;
        path.get('property').replaceWith(t.identifier(path.node.property.value));
    }
})



// rename variables
const globalNames: Map<string, number> = new Map();

traverse(AST, {
    VariableDeclarator(path) {
        const { node } = path;
        if (!t.isIdentifier(node.id)) return;
        // if (!t.isMemberExpression(node.init)) return;
        if(!node.init)return;
        switch (node.init.type) {
            case "MemberExpression":
                {
                    let mostLeftObject: t.Node = node.init;
                    do {
                        mostLeftObject = (mostLeftObject as t.MemberExpression).object;
                    } while (mostLeftObject.hasOwnProperty("object"));
                    if (!t.isIdentifier(mostLeftObject)) return;
                    let name = mostLeftObject.name;
                    while(name[name.length-1] >= '0' && name[name.length-1] <= '9')name=name.substring(0, name.length-1);
                    if (!(
                        name === "window" ||
                        globalNames.has(name)
                    )) return;
    
                    const binding = path.scope.getBinding(node.id.name);
                    if (!binding.constant) return;
                        binding.referencePaths.forEach(refPath => {
                            refPath.replaceWith(node.init);
                        })
                        path.remove();
                }
                break;
            case "CallExpression":
                {
                    if(!t.isMemberExpression(node.init.callee))return;
                    if(!t.isIdentifier(node.init.callee.property))return;
                    if(node.init.callee.computed)return;
                    if(node.init.callee.property.name !== "createElement")return;
                    if(node.init.arguments.length !== 1)return;
                    if(!t.isStringLiteral(node.init.arguments[0]))return;
                    let name = node.init.arguments[0].value;
                    if(!globalNames.has(name))globalNames.set(name, 1);
                    const binding = path.scope.getBinding(node.id.name);
                    if(!binding.constant)return;
                    path.scope.rename(node.id.name, `${name}${globalNames.get(name)}`);
                    globalNames.set(name, globalNames.get(name)+1);
                }
                break;
            default:
                break;
        }

    },

})

// console.log(Object.assign({}, stringDeobbingContext, { window: null }));

fs.writeFileSync(fileName + "_out.js", generate(AST, beautify_opts).code);