#!/bin/sh
# D113 fixture — proves the frame gate actually looks at Dart targets.
# Four states; a correct gate is green,red,red,red. Today it is green,red,GREEN,GREEN.
#   S1 clean target                     -> want 0
#   S2 broken Dart, test/ present       -> want 1
#   S3 broken Dart, NO test/            -> want 1   (bug: `[ -d test ]` ANDs away analyze)
#   S4 broken Dart nested under         -> want 1   (B11: gate probes project root only)
#      <stage>/<track>/<target>/
# Usage: sh scripts/frame-gate-fixture.sh [workdir]
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
W=${1:-$(mktemp -d)}; mkdir -p "$W"
node -e "import('$ROOT/plugins/git-workspace/lib/frame.js').then(m=>{
  require('fs').writeFileSync('$W/check.sh', m.projectCheckSh())})"
chmod +x "$W/check.sh"

mkdir -p "$W/src/todo_core/lib" "$W/src/todo_app/lib" "$W/src/todo_app/test"
cat > "$W/src/todo_core/pubspec.yaml" <<'EOF'
name: todo_core
environment: {sdk: '>=3.0.0 <4.0.0'}
EOF
echo 'class Todo { final String t; Todo(this.t); }' > "$W/src/todo_core/lib/todo_core.dart"
cat > "$W/src/todo_app/pubspec.yaml" <<'EOF'
name: todo_app
environment: {sdk: '>=3.0.0 <4.0.0'}
dependencies:
  todo_core: {path: ../todo_core}
dev_dependencies:
  test: ^1.24.0
EOF
cat > "$W/src/todo_app/lib/main.dart" <<'EOF'
import 'package:todo_core/todo_core.dart';
void main() => print(Todo('milk').t);
EOF
cat > "$W/src/todo_app/test/a_test.dart" <<'EOF'
import 'package:test/test.dart';
import 'package:todo_core/todo_core.dart';
void main() => test('todo holds its title', () => expect(Todo('milk').t, 'milk'));
EOF

BAD="class Z { int x = 'no'; }"
plant() { # plant <dest> <subdir-for-target>
  rm -rf "$1"; mkdir -p "$1/$2"
  cp -R "$W/src/todo_core" "$1/$2/todo_core"; cp -R "$W/src/todo_app" "$1/$2/todo_app"
  rm -rf "$1/$2/todo_app/.dart_tool"
  cp "$W/check.sh" "$1/check.sh"; chmod +x "$1/check.sh"
  ( cd "$1" && git init -q . && git add -A >/dev/null 2>&1 \
    && git -c user.email=a@b -c user.name=a commit -qm "feat: fixture" >/dev/null 2>&1 )
}
runq() { ( cd "$1" && sh ./check.sh >/dev/null 2>&1; echo $?; ) }
chk() { [ "$2" = "$3" ] && echo "ok   $1 exit=$2" || { echo "FAIL $1 exit=$2 want=$3"; RC=1; }; }
RC=0

# S1-S3: check.sh sits in the app dir, todo_core is its sibling (../todo_core resolves)
for s in s1 s2 s3; do plant "$W/$s" .; done
echo "$BAD" > "$W/s2/todo_app/lib/bad.dart"
echo "$BAD" > "$W/s3/todo_app/lib/bad.dart"; rm -rf "$W/s3/todo_app/test"
cp "$W/check.sh" "$W/s1/todo_app/check.sh"; cp "$W/check.sh" "$W/s2/todo_app/check.sh"
cp "$W/check.sh" "$W/s3/todo_app/check.sh"
chk S1-clean          "$(runq "$W/s1/todo_app")" 0
chk S2-broken         "$(runq "$W/s2/todo_app")" 1
chk S3-broken-no-test "$(runq "$W/s3/todo_app")" 1
# S4: check.sh at PROJECT root, real target nested at <stage>/<track>/<target>/
plant "$W/s4" development/application/ios
echo "$BAD" > "$W/s4/development/application/ios/todo_app/lib/bad.dart"
chk S4-broken-nested  "$(runq "$W/s4")" 1

echo "workdir: $W"
exit $RC
