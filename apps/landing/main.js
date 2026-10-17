// nagma.app: the Download button for the visitor's system, and Copy on the code snippets.
// Without JavaScript the button opens the releases page and every platform stays listed.
(function () {
    "use strict";

    var LABELS = { mac: "Download for macOS", windows: "Download for Windows", linux: "Download for Linux" };

    function detect() {
        var nav = window.navigator;
        var platform = ((nav.userAgentData && nav.userAgentData.platform) || nav.platform || "").toLowerCase();
        var ua = (nav.userAgent || "").toLowerCase();
        // Phones and tablets get the releases page: there's no desktop app for them.
        if (/iphone|ipad|ipod|android/.test(ua) || (nav.maxTouchPoints > 1 && /mac/.test(platform))) return null;
        if (/mac/.test(platform) || /mac os x/.test(ua)) return "mac";
        if (/win/.test(platform) || /windows/.test(ua)) return "windows";
        if (/linux|x11/.test(platform) || /linux/.test(ua)) return "linux";
        return null;
    }

    var os = detect();
    var button = document.getElementById("download");
    var label = document.getElementById("download-label");
    if (os && button && label) {
        button.setAttribute("href", "/download/" + os);
        button.setAttribute("data-platform", os);
        label.textContent = LABELS[os];
    }

    var KEYS = os === "mac" ? "\u2318C" : "Ctrl+C";

    // Selects the snippet, so copying by hand works when the clipboard isn't allowed.
    function select(target) {
        var range = document.createRange();
        range.selectNodeContents(target);
        var selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }

    function copy(button) {
        var target = document.getElementById(button.getAttribute("data-copy"));
        if (!target) return;
        var text = target.textContent.replace(/\s+$/, "");
        var done = function (ok) {
            if (!ok) select(target);
            button.textContent = ok ? "Copied" : "Press " + KEYS;
            window.setTimeout(function () {
                button.textContent = "Copy";
            }, 2000);
        };
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(
                function () {
                    done(true);
                },
                function () {
                    done(false);
                },
            );
        } else {
            done(false);
        }
    }

    var buttons = document.querySelectorAll("button[data-copy]");
    for (var i = 0; i < buttons.length; i++) {
        buttons[i].addEventListener("click", function (event) {
            copy(event.currentTarget);
        });
    }
})();
