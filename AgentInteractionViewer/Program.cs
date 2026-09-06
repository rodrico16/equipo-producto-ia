using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Windows.Forms;

namespace AgentInteractionViewer
{
    internal static class Program
    {
        [STAThread]
        private static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            var root = args.Length > 0 && Directory.Exists(args[0])
                ? args[0]
                : Directory.GetCurrentDirectory();
            Application.Run(new MainForm(root));
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly string rootPath;
        private readonly ListView agentsList = new ListView();
        private readonly ListView interactionsList = new ListView();
        private readonly TextBox details = new TextBox();
        private readonly Label summary = new Label();
        private readonly Timer refreshTimer = new Timer();
        private readonly CheckBox autoRefresh = new CheckBox();

        public MainForm(string rootPath)
        {
            this.rootPath = rootPath;
            Text = "Visor de interacción de agentes";
            MinimumSize = new Size(1050, 680);
            Size = new Size(1180, 760);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9F);

            var top = new Panel { Dock = DockStyle.Top, Height = 48, Padding = new Padding(12, 10, 12, 8) };
            var title = new Label
            {
                Text = "Interacciones observadas e inferidas de agentes",
                AutoSize = true,
                Font = new Font(Font, FontStyle.Bold),
                Location = new Point(12, 15)
            };
            var refresh = new Button { Text = "Actualizar", Width = 95, Height = 28, Anchor = AnchorStyles.Top | AnchorStyles.Right };
            refresh.Location = new Point(Width - 240, 10);
            refresh.Click += delegate { LoadData(); };
            autoRefresh.Text = "Auto";
            autoRefresh.Width = 60;
            autoRefresh.Height = 28;
            autoRefresh.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            autoRefresh.Location = new Point(Width - 135, 12);
            autoRefresh.CheckedChanged += delegate { refreshTimer.Enabled = autoRefresh.Checked; };
            top.Resize += delegate
            {
                refresh.Location = new Point(top.Width - 175, 10);
                autoRefresh.Location = new Point(top.Width - 72, 12);
            };
            top.Controls.Add(title);
            top.Controls.Add(refresh);
            top.Controls.Add(autoRefresh);

            summary.Dock = DockStyle.Bottom;
            summary.Height = 30;
            summary.Padding = new Padding(12, 7, 12, 0);

            var split = new SplitContainer { Dock = DockStyle.Fill, SplitterDistance = 360 };
            var rightSplit = new SplitContainer { Dock = DockStyle.Fill, Orientation = Orientation.Horizontal, SplitterDistance = 360 };

            SetupList(agentsList, "Agente", "Misión", "Archivo");
            SetupList(interactionsList, "Hora", "Origen", "Destino", "Evidencia", "Archivo");
            details.Multiline = true;
            details.ReadOnly = true;
            details.ScrollBars = ScrollBars.Vertical;
            details.Dock = DockStyle.Fill;
            details.BackColor = Color.White;

            agentsList.SelectedIndexChanged += delegate { ShowSelectedDetails(agentsList); };
            interactionsList.SelectedIndexChanged += delegate { ShowSelectedDetails(interactionsList); };

            split.Panel1.Controls.Add(Wrap("Agentes instalados", agentsList));
            rightSplit.Panel1.Controls.Add(Wrap("Timeline de coordinación", interactionsList));
            rightSplit.Panel2.Controls.Add(Wrap("Detalle", details));
            split.Panel2.Controls.Add(rightSplit);

            Controls.Add(split);
            Controls.Add(summary);
            Controls.Add(top);

            refreshTimer.Interval = 5000;
            refreshTimer.Tick += delegate { LoadData(); };
            LoadData();
        }

        private static void SetupList(ListView list, params string[] columns)
        {
            list.View = View.Details;
            list.FullRowSelect = true;
            list.GridLines = true;
            list.Dock = DockStyle.Fill;
            foreach (var col in columns)
                list.Columns.Add(col, col == "Misión" ? 220 : 110);
        }

        private static Control Wrap(string caption, Control child)
        {
            var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(8) };
            var label = new Label
            {
                Text = caption,
                Dock = DockStyle.Top,
                Height = 26,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold)
            };
            panel.Controls.Add(child);
            panel.Controls.Add(label);
            return panel;
        }

        private void LoadData()
        {
            var agents = ReadAgents();
            var interactions = InferInteractions(agents);

            agentsList.Items.Clear();
            foreach (var agent in agents)
            {
                var item = new ListViewItem(agent.Name);
                item.SubItems.Add(agent.Description);
                item.SubItems.Add(agent.FileName);
                item.Tag = agent.Raw;
                agentsList.Items.Add(item);
            }

            interactionsList.Items.Clear();
            foreach (var entry in interactions.OrderByDescending(x => x.Timestamp))
            {
                var item = new ListViewItem(entry.Timestamp.ToString("yyyy-MM-dd HH:mm:ss"));
                item.SubItems.Add(entry.Source);
                item.SubItems.Add(entry.Target);
                item.SubItems.Add(entry.Evidence);
                item.SubItems.Add(entry.FileName);
                item.Tag = entry.Detail;
                interactionsList.Items.Add(item);
            }

            summary.Text = string.Format(
                "Proyecto: {0} | Agentes: {1} | Señales: {2} | Fuente: archivos locales; inferencias marcadas por evidencia",
                rootPath, agents.Count, interactions.Count);
        }

        private List<AgentInfo> ReadAgents()
        {
            var dir = Path.Combine(rootPath, ".codex", "agents");
            if (!Directory.Exists(dir))
                dir = Path.Combine(rootPath, "perfiles-agentes");
            if (!Directory.Exists(dir))
                return new List<AgentInfo>();

            return Directory.GetFiles(dir, "*.toml")
                .Select(path =>
                {
                    var raw = File.ReadAllText(path);
                    return new AgentInfo
                    {
                        Name = ReadTomlValue(raw, "name") ?? Path.GetFileNameWithoutExtension(path),
                        Description = ReadTomlValue(raw, "description") ?? "",
                        FileName = MakeRelative(path),
                        Raw = raw
                    };
                })
                .OrderBy(a => a.Name)
                .ToList();
        }

        private List<InteractionEntry> InferInteractions(List<AgentInfo> agents)
        {
            var entries = new List<InteractionEntry>();
            var docs = new[] { "AGENTS.md", "EQUIPO.md", "TOKEN_POLICY.md", "METRICAS_TOKENS.md", "LEEME.md" };
            foreach (var name in docs)
            {
                var path = Path.Combine(rootPath, name);
                if (!File.Exists(path))
                    continue;

                var text = File.ReadAllText(path);
                var modified = File.GetLastWriteTime(path);
                foreach (var agent in agents)
                {
                    var hits = CountMentions(text, agent.Name);
                    if (hits == 0)
                        continue;
                    entries.Add(new InteractionEntry
                    {
                        Timestamp = modified,
                        Source = "documentación",
                        Target = agent.Name,
                        Evidence = hits + " mención(es)",
                        FileName = name,
                        Detail = BuildDetail(path, agent, hits, text)
                    });
                }
            }

            var agentFiles = Directory.Exists(Path.Combine(rootPath, ".codex", "agents"))
                ? Directory.GetFiles(Path.Combine(rootPath, ".codex", "agents"), "*.toml")
                : new string[0];
            foreach (var path in agentFiles)
            {
                var text = File.ReadAllText(path);
                var owner = Path.GetFileNameWithoutExtension(path);
                foreach (var agent in agents.Where(a => !SameAgent(a.Name, owner)))
                {
                    var hits = CountMentions(text, agent.Name);
                    if (hits == 0)
                        continue;
                    entries.Add(new InteractionEntry
                    {
                        Timestamp = File.GetLastWriteTime(path),
                        Source = owner,
                        Target = agent.Name,
                        Evidence = "referencia en perfil",
                        FileName = MakeRelative(path),
                        Detail = BuildDetail(path, agent, hits, text)
                    });
                }
            }

            AddTokenMetrics(entries);
            return entries;
        }

        private void AddTokenMetrics(List<InteractionEntry> entries)
        {
            var path = Path.Combine(rootPath, "token-sessions.csv");
            if (!File.Exists(path))
                return;
            var lines = File.ReadAllLines(path).Skip(1).Where(l => !string.IsNullOrWhiteSpace(l)).ToList();
            entries.Add(new InteractionEntry
            {
                Timestamp = File.GetLastWriteTime(path),
                Source = "supervisor",
                Target = "métricas",
                Evidence = lines.Count == 0 ? "sin sesiones medidas" : lines.Count + " sesión(es)",
                FileName = "token-sessions.csv",
                Detail = lines.Count == 0
                    ? "El archivo existe, pero no hay sesiones con tokens reales registrados."
                    : string.Join(Environment.NewLine, lines.ToArray())
            });
        }

        private string BuildDetail(string path, AgentInfo agent, int hits, string text)
        {
            var snippets = Regex.Matches(text, ".{0,80}" + Regex.Escape(agent.Name) + ".{0,120}", RegexOptions.IgnoreCase)
                .Cast<Match>()
                .Take(5)
                .Select(m => m.Value.Replace("\r", " ").Replace("\n", " ").Trim());
            return "Archivo: " + path + Environment.NewLine +
                   "Agente: " + agent.Name + Environment.NewLine +
                   "Evidencia: " + hits + " mención(es) textual(es)" + Environment.NewLine +
                   Environment.NewLine +
                   string.Join(Environment.NewLine + Environment.NewLine, snippets.ToArray());
        }

        private static string ReadTomlValue(string text, string key)
        {
            var match = Regex.Match(text, "^" + Regex.Escape(key) + "\\s*=\\s*\"([^\"]*)\"", RegexOptions.Multiline);
            return match.Success ? match.Groups[1].Value : null;
        }

        private static int CountMentions(string text, string value)
        {
            if (string.IsNullOrWhiteSpace(value))
                return 0;
            return Regex.Matches(text, "\\b" + Regex.Escape(value) + "\\b", RegexOptions.IgnoreCase).Count;
        }

        private static bool SameAgent(string a, string b)
        {
            return NormalizeAgent(a) == NormalizeAgent(b);
        }

        private static string NormalizeAgent(string value)
        {
            return value.ToLowerInvariant().Replace(" ", "_").Replace("-", "_");
        }

        private string MakeRelative(string path)
        {
            return path.StartsWith(rootPath, StringComparison.OrdinalIgnoreCase)
                ? path.Substring(rootPath.Length).TrimStart(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                : path;
        }

        private void ShowSelectedDetails(ListView list)
        {
            if (list.SelectedItems.Count == 0)
                return;
            details.Text = Convert.ToString(list.SelectedItems[0].Tag);
        }
    }

    internal sealed class AgentInfo
    {
        public string Name;
        public string Description;
        public string FileName;
        public string Raw;
    }

    internal sealed class InteractionEntry
    {
        public DateTime Timestamp;
        public string Source;
        public string Target;
        public string Evidence;
        public string FileName;
        public string Detail;
    }
}
