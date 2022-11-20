const traverse = require("@babel/traverse").default;
const generate = require("@babel/generator").default;
const parse = require("@babel/parser").parse;
const t = require("@babel/types");
const axios = require("axios");

const url = "https://epsf.ticketmaster.com/eps-d";
const id = "ourScript";

(async () => {
    const resp = await axios.get(url);
    let script = resp.data;
    let AST = parse(script);

    traverse(AST, {
        StringLiteral(path) {
            if(!["body", "getElementsByTagName"].includes(path.node.value))return;
            switch (path.node.value) {
                case "body":
                {
                    if (path.key !== "key") return;
                    if (!t.isObjectProperty(path.parent)) return;
                    if (!t.isIdentifier(path.parent.value)) return;
                    let nodePathInSeqExpr = path.parentPath.parentPath.parentPath.parentPath;
                    let nodeToAppend = t.expressionStatement(t.callExpression(t.memberExpression(t.identifier("console"), t.identifier("log"), false), [t.identifier(path.parent.value.name)]));
                    let windowCloseNode = t.expressionStatement(t.callExpression(t.memberExpression(t.identifier("window"), t.identifier("close"), false), []));
                    nodePathInSeqExpr.replaceWith(nodeToAppend);
                    nodePathInSeqExpr.insertAfter(windowCloseNode);
                }
                    break;
                case "getElementsByTagName":
                {
                    let wantedParent = path.findParent(p => p.isCallExpression()).findParent(p => p.isCallExpression());
                    let nodeToReplaceWith = t.callExpression(t.memberExpression(t.identifier("document"), t.identifier("getElementById")), [t.stringLiteral(id)])
                    wantedParent.replaceWith(nodeToReplaceWith);
                }
                    break;
                default:
                    break;
            }
        }
    })

    console.log(`<script id=\"ourScript\" async>${generate(AST, { minified: true, concise: true, retainFunctionParens: true }).code}</script>`);
})();
