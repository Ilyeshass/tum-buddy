import json
import re
import sys
import unicodedata
from io import BytesIO

from pypdf import PdfReader


SECTION_ALIASES = {
    "skills": ["skills", "kompetenzen", "technical skills", "technologies", "stack"],
    "languages": ["languages", "sprachen"],
    "interests": ["interests", "interessen"],
    "projects": ["projects", "projekte"],
    "education": ["education", "ausbildung", "studium"],
    "experience": ["experience", "berufserfahrung", "work experience", "praktische erfahrung"],
}

SKILL_PATTERNS = {
    "Python": [r"\bpython\b"],
    "Java": [r"\bjava\b"],
    "JavaScript": [r"\bjavascript\b", r"\bjs\b"],
    "TypeScript": [r"\btypescript\b", r"\bts\b"],
    "C++": [r"\bc\+\+\b"],
    "C#": [r"\bc#\b"],
    "SQL": [r"\bsql\b", r"\bmysql\b", r"\bpostgres(?:ql)?\b"],
    "HTML": [r"\bhtml\b"],
    "CSS": [r"\bcss\b"],
    "React": [r"\breact\b"],
    "Node.js": [r"\bnode(?:\.js)?\b"],
    "FastAPI": [r"\bfastapi\b"],
    "Flask": [r"\bflask\b"],
    "Django": [r"\bdjango\b"],
    "Docker": [r"\bdocker\b"],
    "Kubernetes": [r"\bkubernetes\b", r"\bk8s\b"],
    "Git": [r"\bgit\b", r"\bgithub\b"],
    "Linux": [r"\blinux\b"],
    "Machine Learning": [r"\bmachine learning\b", r"\bml\b"],
    "Deep Learning": [r"\bdeep learning\b"],
    "Data Science": [r"\bdata science\b"],
    "Artificial Intelligence": [r"\bartificial intelligence\b", r"\bai\b"],
    "NLP": [r"\bnlp\b", r"\bnatural language processing\b"],
    "Computer Vision": [r"\bcomputer vision\b"],
    "Cybersecurity": [r"\bcyber ?security\b", r"\bsecurity\b"],
    "Backend": [r"\bbackend\b", r"\bback end\b"],
    "Frontend": [r"\bfrontend\b", r"\bfront end\b"],
    "Full Stack": [r"\bfull stack\b"],
    "APIs": [r"\bapi\b", r"\bapis\b", r"\brest\b"],
    "MongoDB": [r"\bmongodb\b"],
    "Supabase": [r"\bsupabase\b"],
    "Playwright": [r"\bplaywright\b"],
    "Selenium": [r"\bselenium\b"],
    "Pandas": [r"\bpandas\b"],
    "NumPy": [r"\bnumpy\b"],
    "Scikit-learn": [r"\bscikit[- ]learn\b", r"\bsklearn\b"],
    "TensorFlow": [r"\btensorflow\b"],
    "PyTorch": [r"\bpytorch\b"],
    "AWS": [r"\baws\b", r"\bamazon web services\b"],
    "Azure": [r"\bazure\b"],
}

DOMAIN_PATTERNS = {
    "AI": [r"\bartificial intelligence\b", r"(?<![a-z])ai(?![a-z])"],
    "Machine Learning": [r"\bmachine learning\b", r"\bml\b"],
    "Data Science": [r"\bdata science\b"],
    "Software Engineering": [r"\bsoftware engineering\b", r"\bsoftwareentwicklung\b"],
    "Cybersecurity": [r"\bcyber ?security\b", r"\bsecurity\b"],
    "Robotics": [r"\brobotics\b", r"\brobotik\b"],
    "Cloud": [r"\bcloud\b"],
    "Distributed Systems": [r"\bdistributed systems\b"],
    "Web Development": [r"\bweb development\b", r"\bwebsite\b", r"\bweb app\b"],
    "Backend": [r"\bbackend\b"],
    "Frontend": [r"\bfrontend\b"],
    "Research": [r"\bresearch\b", r"\bforschung\b"],
}

LANGUAGE_PATTERNS = {
    "English": [r"english"],
    "German": [r"german", r"deutsch"],
    "French": [r"french", r"franzosisch", r"francais"],
    "Arabic": [r"arabic", r"arabisch"],
}

LOCATION_PATTERNS = {
    "Munich": [r"\bmunich\b", r"\bmunchen\b", r"\bmuenchen\b"],
    "Berlin": [r"\bberlin\b"],
    "Hamburg": [r"\bhamburg\b"],
    "Frankfurt": [r"\bfrankfurt\b"],
    "Remote": [r"\bremote\b"],
}

INTEREST_TERMS = [
    "ai", "machine learning", "data science", "software engineering", "security",
    "robotics", "cloud", "backend", "frontend", "research", "web development",
]


def extract_text(file_bytes: bytes) -> str:
    reader = PdfReader(BytesIO(file_bytes))
    pages = []
    for page in reader.pages:
        text = page.extract_text() or ""
        text = text.strip()
        if text:
            pages.append(text)
    return "\n\n".join(pages).strip()


def normalize_text(text: str) -> str:
    text = text.replace("\r", "\n")
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    return text


def collapse_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def split_lines(text: str) -> list[str]:
    return [line.strip(" -•\t") for line in text.splitlines() if line.strip()]


def detect_sections(lines: list[str]) -> dict[str, list[str]]:
    sections = {key: [] for key in SECTION_ALIASES}
    current = None

    for line in lines:
        normalized = collapse_spaces(line).lower().rstrip(":")
        matched = None

        for key, aliases in SECTION_ALIASES.items():
            if normalized in aliases:
                matched = key
                break

        if matched:
            current = matched
            continue

        if current:
            sections[current].append(line)

    return sections


def collect_pattern_matches(text: str, pattern_map: dict[str, list[str]]) -> list[str]:
    matches = []
    for label, patterns in pattern_map.items():
        if any(re.search(pattern, text, re.IGNORECASE) for pattern in patterns):
            matches.append(label)
    return matches


def infer_degree_and_field(text: str, education_lines: list[str]) -> tuple[str, str]:
    joined = collapse_spaces(" ".join(education_lines) or text)
    degree = ""
    field = ""

    degree_patterns = [
        (r"\bbachelor of science\b|\bb\.?\s*sc\b", "B.Sc."),
        (r"\bmaster of science\b|\bm\.?\s*sc\b", "M.Sc."),
        (r"\bbachelor of arts\b|\bb\.?\s*a\b", "B.A."),
        (r"\bmaster of arts\b|\bm\.?\s*a\b", "M.A."),
    ]

    for pattern, label in degree_patterns:
        if re.search(pattern, joined, re.IGNORECASE):
            degree = label
            break

    field_patterns = [
        (r"\bwirtschaftsinformatik\b", "Business Informatics"),
        (r"\binformatics\b|\binformatik\b|\bcomputer science\b", "Informatics"),
        (r"\bdata science\b", "Data Science"),
        (r"\bmachine learning\b", "Machine Learning"),
        (r"\bsoftware engineering\b", "Software Engineering"),
        (r"\bcyber ?security\b", "Cybersecurity"),
    ]

    for pattern, label in field_patterns:
        if re.search(pattern, joined, re.IGNORECASE):
            field = label
            break

    return degree, field


def infer_preferred_types(text: str, sections: dict[str, list[str]], domains: list[str]) -> list[str]:
    joined = collapse_spaces(text).lower()
    values = []

    if any(term in joined for term in ["research", "lab", "chair", "publication", "thesis", "forschung"]):
        values.append("research")
    if any(term in joined for term in ["intern", "internship", "praktikum"]):
        values.append("internship")
    if any(term in joined for term in ["working student", "werkstudent", "hiwi", "student assistant", "studentische hilfskraft"]):
        values.append("job")
    if sections.get("projects"):
        values.append("project-based")
    if any(domain in domains for domain in ["AI", "Machine Learning", "Software Engineering", "Data Science", "Cybersecurity"]):
        values.append("job")

    deduped = []
    for value in values or ["job"]:
        if value not in deduped:
            deduped.append(value)
    return deduped


def infer_interests(sections: dict[str, list[str]], normalized_text: str, domains: list[str]) -> list[str]:
    interests = []

    interest_text = collapse_spaces(" ".join(sections.get("interests", []))).lower()
    for term in INTEREST_TERMS:
        pattern = re.escape(term)
        if len(term) <= 3:
            pattern = rf"(?<![a-z]){pattern}(?![a-z])"
        if re.search(pattern, interest_text, re.IGNORECASE):
            label = "AI" if term == "ai" else term.title()
            if label not in interests:
                interests.append(label)

    for domain in domains:
        if domain not in interests:
            interests.append(domain)

    if "football" in normalized_text.lower() and "Teamwork" not in interests:
        interests.append("Teamwork")

    return interests[:8]


def infer_keywords(skills: list[str], domains: list[str], field: str, sections: dict[str, list[str]]) -> list[str]:
    keywords = []
    for value in skills + domains:
        if value and value not in keywords:
            keywords.append(value)

    if field and field not in keywords:
        keywords.append(field)

    projects_text = collapse_spaces(" ".join(sections.get("projects", [])))
    for token in ["website", "backend", "frontend", "physics", "mathematics"]:
        if token in projects_text.lower():
            label = token.title() if token != "backend" and token != "frontend" else token.capitalize()
            if label not in keywords:
                keywords.append(label)

    return keywords[:12]


def build_summary(degree: str, field: str, domains: list[str], skills: list[str], preferred_types: list[str]) -> str:
    fragments = []
    if degree and field:
        fragments.append(f"{degree} student in {field}")
    elif degree:
        fragments.append(f"{degree} student")

    if domains:
        fragments.append(f"interested in {', '.join(domains[:3])}")

    if skills:
        fragments.append(f"with skills in {', '.join(skills[:5])}")

    if preferred_types:
        fragments.append(f"best suited for {', '.join(preferred_types[:2])} roles")

    if not fragments:
        return "Student profile extracted from CV."

    sentence = " ".join([fragments[0].capitalize(), *fragments[1:]])
    return sentence + "."


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Missing PDF path"}))
        return 1

    pdf_path = sys.argv[1]
    with open(pdf_path, "rb") as f:
        file_bytes = f.read()

    raw_text = extract_text(file_bytes)
    if not raw_text:
        print(json.dumps({"error": "Could not extract text from PDF"}))
        return 1

    normalized_text = normalize_text(raw_text)
    lines = split_lines(normalized_text)
    sections = detect_sections(lines)

    skills = collect_pattern_matches(normalized_text, SKILL_PATTERNS)
    domains = collect_pattern_matches(normalized_text, DOMAIN_PATTERNS)
    languages = collect_pattern_matches(normalized_text, LANGUAGE_PATTERNS)
    locations = collect_pattern_matches(normalized_text, LOCATION_PATTERNS)
    degree, field = infer_degree_and_field(normalized_text, sections.get("education", []))
    preferred_types = infer_preferred_types(normalized_text, sections, domains)
    interests = infer_interests(sections, normalized_text, domains)
    keywords = infer_keywords(skills, domains, field, sections)
    summary = build_summary(degree, field, domains, skills, preferred_types)

    result = {
        "degree": f"{degree} {field}".strip(),
        "degree_level": degree,
        "study_field": field,
        "summary": summary,
        "skills": skills[:14],
        "domains": domains[:8],
        "suggested_interests": interests[:8],
        "preferred_types": preferred_types[:4],
        "preferred_locations": locations[:4],
        "preferred_languages": languages[:4],
        "keywords": keywords,
        "detected_sections": {key: value[:8] for key, value in sections.items() if value},
        "text_preview": raw_text[:1600]
    }

    print(json.dumps(result, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
