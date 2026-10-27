from datetime import datetime, timedelta

from engagement import CREATE, REVIEW, SKIP, ErpFacts, decide, erp_url_variants, post_key, \
    profile_key, read_exports, read_posts_registry


def test_profile_key():
    assert profile_key("https://www.linkedin.com/in/Mette-Hansen-12ab/?originalSubdomain=dk") \
        == "in:mette-hansen-12ab"
    assert profile_key("linkedin.com/in/s%C3%B8ren-k") == "in:søren-k"
    assert profile_key("https://www.linkedin.com/in/ACoAAB12cdEF") == "urn:ACoAAB12cdEF"
    assert profile_key("https://www.linkedin.com/sales/lead/ACwAAA1,NAME_SEARCH,x") == "urn:ACwAAA1"
    assert profile_key("https://www.linkedin.com/company/f5") is None
    assert profile_key("") is None


def test_url_variants_roundtrip():
    for v in erp_url_variants("in:mette"):
        assert profile_key(v) == "in:mette"


def test_post_key():
    a = post_key("https://www.linkedin.com/feed/update/urn:li:activity:7380000000000000000/")
    b = post_key("https://www.linkedin.com/posts/x_topic-activity-7380000000000000000-AbCd?utm=1")
    assert a == b == "7380000000000000000"


def test_read_exports_dedupes(tmp_path):
    likers = tmp_path / "likers.csv"
    likers.write_text(
        "profileUrl,fullName,occupation,reactionType,postUrl\n"
        "https://www.linkedin.com/in/anna/,Anna Berg,CFO at Acme,LIKE,"
        "https://www.linkedin.com/feed/update/urn:li:activity:7380000000000000000/\n"
        "https://www.linkedin.com/company/x,Company,,LIKE,\n", encoding="utf-8")
    comments = tmp_path / "comments.csv"
    comments.write_text(
        "profileLink;firstName;lastName;comment;postUrl\n"
        "https://linkedin.com/in/Anna;Anna;Berg;Great!;"
        "https://www.linkedin.com/posts/f5_x-activity-7380000000000000001-zz\n", encoding="utf-8")
    e = read_exports([likers, comments])
    assert list(e) == ["in:anna"]
    anna = e["in:anna"]
    assert (anna.first_name, anna.last_name, anna.headline) == ("Anna", "Berg", "CFO at Acme")
    assert anna.engagements == [("7380000000000000000", "like"), ("7380000000000000001", "comment")]


def test_posts_registry(tmp_path):
    p = tmp_path / "posts.csv"
    p.write_text("post_url;source\nhttps://x/feed/update/urn:li:activity:7380000000000000000;F5_SE\n")
    assert read_posts_registry(p) == {"7380000000000000000": "F5_SE"}


NOW = datetime(2026, 10, 27)
RULES = {"recent_contact_days": 60}
ICP = [(1, "CFO DK", 10)]


def test_decide():
    assert decide(ErpFacts([1], icp_segments=ICP), RULES, NOW)[0] == CREATE
    assert decide(ErpFacts([1]), RULES, NOW)[0] == REVIEW
    assert decide(ErpFacts([1]), {**RULES, "non_icp_action": "skip"}, NOW)[0] == SKIP
    assert decide(ErpFacts([1], icp_segments=ICP, open_opp_ids=[5]), RULES, NOW)[0] == SKIP
    assert decide(ErpFacts([1], icp_segments=ICP, never_contact=True), RULES, NOW)[0] == SKIP
    assert decide(ErpFacts([1], icp_segments=ICP, active_member=True), RULES, NOW)[0] == SKIP
    recent = ErpFacts([1], icp_segments=ICP, last_contact=NOW - timedelta(days=30))
    old = ErpFacts([1], icp_segments=ICP, last_contact=NOW - timedelta(days=90))
    assert decide(recent, RULES, NOW)[0] == SKIP
    assert decide(old, RULES, NOW)[0] == CREATE
